'use strict';

const path = require('path');

const addCustomResource = require('add-custom-resource');

module.exports = class KinesisConsumerPlugin {

  constructor(serverless, options) {
    const provider = 'aws';
    const hooks = {
      'before:aws:package:finalize:mergeCustomProviderResources': this.package.bind(this)
    };

    Object.assign(this, { serverless, options, provider, hooks });
  }

  package() {
    const aws = this.serverless.getProvider('aws');
    const service = this.serverless.service;
    const functions = service.functions;
    const template = service.provider.compiledCloudFormationTemplate;

    const consumers = this.getConsumers(template, functions, aws);

    return this.configureConsumers(template, consumers);
  }

  getConsumers(template, functions, aws) {
    return Object.entries(functions).reduce((memo, [ name, config ]) => {
      if (Array.isArray(config.events)) {
        config.events.forEach(event => {
          if (event.stream && event.stream.type === 'kinesis' && event.stream.consumer) {
            const functionName = aws.naming.getNormalizedFunctionName(name);
            const functionLogicalId = aws.naming.getLambdaLogicalId(name);

            const streamArn = event.stream.arn;
            const streamName = this.getStreamName(streamArn);
            const streamLogicalId = aws.naming.getStreamLogicalId(name, 'kinesis', streamName);

            const consumerName = this.getConsumerName(event.stream.consumer, functionName, streamName);
            const consumerLogicalId = aws.naming.normalizeNameToAlphaNumericOnly(`${functionName}Consumer${streamName}`);

            memo.push({
              functionName,
              functionLogicalId,
              streamArn,
              streamLogicalId,
              consumerName,
              consumerLogicalId,
            });
          }
        });
      }
      return memo;
    }, []);
  }

  getStreamName(arn) {
    if (arn['Fn::GetAtt']) {
      return arn['Fn::GetAtt'][0];
    }

    if (arn['Fn::ImportValue']) {
      return arn['Fn::ImportValue'];
    }

    return arn.split('/')[1];
  }

  getConsumerName(consumer, functionName, streamName) {
    if (typeof consumer === 'string') {
      return consumer;
    }
    return `${functionName}${streamName}Consumer`; 
  }

  configureConsumers(template, consumers) {
    const sourceCodePath = path.join(__dirname, 'lib', 'kinesis-consumer.js');
    const streamArns = consumers.map(consumer => consumer.streamArn);

    return consumers.reduce((memo, consumer) => {
      const {
        functionName,
        functionLogicalId,
        streamArn,
        streamLogicalId,
        consumerName,
        consumerLogicalId,
      } = consumer;

      const functionResource = template.Resources[functionLogicalId];

      if (!functionResource) {
        throw new Error(`Missing function resource ${functionLogicalId}`);
      }

      const functionRole = this.getFunctionRole(functionLogicalId, functionResource);
      const streamResource = template.Resources[streamLogicalId];

      if (!streamResource) {
        throw new Error(`Missing event source mapping resource ${streamLogicalId}`);
      }

      return memo.then(() => {
        return addCustomResource(template, {
          resourceName: consumerLogicalId,
          name: 'KinesisConsumer',
          sourceCodePath,
          resource: {
            properties: {
              ConsumerName: this.qualifyConsumerName(consumerName),
              StreamARN: streamArn
            },
          },
          role: {
            policies: [{
              PolicyName: 'manage-consumers',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [{
                  Effect: 'Allow',
                  Action: 'kinesis:RegisterStreamConsumer',
                  Resource: streamArns
                }, {
                  Effect: 'Allow',
                  Action: [
                    'kinesis:DeregisterStreamConsumer',
                    'kinesis:DescribeStreamConsumer'
                  ],
                  Resource: streamArns.map(arn => ({
                    'Fn::Join': ['/', [arn, 'consumer', '*' ] ]
                  }))
                }]
              }
            }]
          }
        })
        .then(consumerLogicalId => {
          const consumerArn = { 'Fn::GetAtt': [consumerLogicalId, 'ConsumerARN'] };

          const policyName = `${functionName}ConsumerPolicy`;
          const policy = this.preparePolicy(template, policyName, functionRole);

          policy.Properties.PolicyDocument.Statement[0].Resource.push(streamArn);
          policy.Properties.PolicyDocument.Statement[1].Resource.push(consumerArn);

          streamResource.Properties.EventSourceArn = consumerArn;
          streamResource.DependsOn = [policyName].concat(streamResource.DependsOn).filter(x => x)
        });
      });
    }, Promise.resolve());
  }

  getFunctionRole(functionLogicalId, lambdaFunction) {
    const role = lambdaFunction.Properties.Role;

    if (role['Fn::GetAtt']) {
      return {
        Ref: role['Fn::GetAtt'][0],
      }
    }
    throw new Error(`Unexpected Role for ${functionLogicalId} (expected 'Fn::GetAtt')`);
  }

  preparePolicy(template, policyName, role) {
    return template.Resources[policyName] = template.Resources[policyName] || {
      Type: 'AWS::IAM::Policy',
      Properties: {
        PolicyName: policyName,
        PolicyDocument: {
          Version: '2012-10-17',
          Statement: [{
            Effect: 'Allow',
            Action: [
              'kinesis:DescribeStreamSummary',
              'kinesis:ListShards',
              'kinesis:GetShardIterator',
              'kinesis:GetRecords',
            ],
            Resource: []
          }, {
            Effect: 'Allow',
            Action: [
              'kinesis:SubscribeToShard',
            ],
            Resource: []
          }]
        },
        Roles: [role]
      }
    };
  }

  qualifyConsumerName(consumerName) {
    const serviceName = this.serverless.service.service;
    const stageName = this.serverless.service.provider.stage;

    return `${serviceName}-${stageName}-${consumerName}`;
  }

};