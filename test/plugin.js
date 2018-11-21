'use strict';

const test = require('ava');
const sinon = require('sinon');

const Plugin = require('..');

const functions = {
  skip: {},
  test: {
    events: [{
      stream: 'arn:test:foo:bar'
    }, {
      stream: {
        type: 'dynamodb'
      }
    }, {
      stream: {
        type: 'kinesis'
      }
    }, {
      stream: {
        type: 'kinesis',
        consumer: true,
        arn: {
          'Fn::GetAtt': ['Stream', 'Arn']
        }
      }
    }, {
      stream: {
        type: 'kinesis',
        consumer: 'testing',
        arn: {
          'Fn::GetAtt': ['OtherStream', 'Arn']
        }
      }
    }]
  },
  other: {
    events: [{
      stream: 'arn:test:foo:bar'
    }, {
      stream: {
        type: 'dynamodb'
      }
    }, {
      stream: {
        type: 'kinesis'
      }
    }]
  }
};

const compiledCloudFormationTemplate = {
  Resources: {
    TestLambdaFunction: {
      Type: 'AWS::Lambda::Function',
      Properties: {
        Role: {
          'Fn::GetAtt': ['TestLambdaRole', 'Arn']
        }
      }
    }
  }
};

test('has hook and fn', t => {
  const serverless = {};
  const plugin = new Plugin(serverless);

  t.is(typeof plugin.hooks, 'object');
  t.is(typeof plugin.package, 'function');
});

test('calls appropriate methods', t => {
  const compiledCloudFormationTemplate = {
    Resources: {
      TestLambdaFunction: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          Role: {
            'Fn::GetAtt': ['TestLambdaRole', 'Arn']
          }
        }
      }
    }
  };
  const getNormalizedFunctionName = sinon.stub().returns('Test');
  const getLambdaLogicalId = sinon.stub().returns('TestLambdaFunction');
  const aws = { naming: { getNormalizedFunctionName, getLambdaLogicalId } };
  const provider = { compiledCloudFormationTemplate };
  const service = { functions, provider }
  const getProvider = () => aws;

  const serverless = { service, getProvider };
  const plugin = new Plugin(serverless);

  const getConsumers = sinon.stub(plugin, 'getConsumers').returns(['test']);
  const configureConsumers = sinon.stub(plugin, 'configureConsumers').resolves();

  return plugin.package()
    .then(() => {
      t.is(getConsumers.callCount, 1);
      t.is(configureConsumers.callCount, 1);
      t.deepEqual(configureConsumers.firstCall.args[1], ['test']);
      t.is(getNormalizedFunctionName.callCount, 0);
      t.is(getLambdaLogicalId.callCount, 0);
    });
});

test('getConsumers', t => {
  const getNormalizedFunctionName = sinon.stub().returns('Test');
  const getLambdaLogicalId = sinon.stub().returns('TestLambdaFunction');
  const getStreamLogicalId = sinon.stub().returns('Stream');
  const normalizeNameToAlphaNumericOnly = sinon.stub().returns('Normalized');

  const naming = {
    normalizeNameToAlphaNumericOnly,
    getNormalizedFunctionName,
    getLambdaLogicalId,
    getStreamLogicalId
  };

  const aws = { naming };
  const provider = { compiledCloudFormationTemplate };
  const service = { functions, provider }
  const getProvider = () => aws;

  const serverless = { service, getProvider };
  const plugin = new Plugin(serverless);

  const consumers = plugin.getConsumers(compiledCloudFormationTemplate, functions, aws);

  t.deepEqual(consumers, [{
    functionLogicalId: 'TestLambdaFunction',
    functionName: 'Test',
    consumerLogicalId: 'Normalized',
    consumerName: 'TestStreamConsumer',
    streamArn: {
      'Fn::GetAtt': ['Stream', 'Arn'],
    },
    streamLogicalId: 'Stream'
  }, {
    functionLogicalId: 'TestLambdaFunction',
    functionName: 'Test',
    consumerLogicalId: 'Normalized',
    consumerName: 'testing',
    streamArn: {
      'Fn::GetAtt': ['OtherStream', 'Arn'],
    },
    streamLogicalId: 'Stream'
  }]);
});

test('getFunctionRole throws when not the right format', t => {
  const plugin = new Plugin({});

  const err = t.throws(() => plugin.getFunctionRole('foo', { Properties: { Role: {} } }));

  t.is(err.message, 'Unexpected Role for foo (expected \'Fn::GetAtt\')');
});

test('configureConsumers throws if function not found', t => {
  const plugin = new Plugin({});

  const err = t.throws(() => plugin.configureConsumers({ Resources: {} }, [{
    functionLogicalId: 'foo'
  }]));

  t.is(err.message, 'Missing function resource foo');
});

test('getStreamName GetAtt', t => {
  const plugin = new Plugin({});

  const streamName = plugin.getStreamName({ 'Fn::GetAtt': ['foo', 'arn'] });

  t.is(streamName, 'foo');
});

test('getStreamName ImportValue', t => {
  const plugin = new Plugin({});

  const streamName = plugin.getStreamName({ 'Fn::ImportValue': 'foo' });

  t.is(streamName, 'foo');
});

test('getStreamName arn', t => {
  const plugin = new Plugin({});

  const streamName = plugin.getStreamName('arn:aws:firehose:us-east-1:123456789012:deliverystream/example-stream-name');

  t.is(streamName, 'example-stream-name');
});

test('configureConsumers throws if function not found', t => {
  const compiledCloudFormationTemplate = {
    Resources: {
      TestLambdaFunction: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          Role: {
            'Fn::GetAtt': ['TestLambdaRole', 'Arn']
          }
        }
      }
    }
  };
  const plugin = new Plugin({});

  const err = t.throws(() => plugin.configureConsumers(compiledCloudFormationTemplate, [{
    functionLogicalId: 'TestLambdaFunction',
    streamLogicalId: 'foo'
  }]));

  t.is(err.message, 'Missing event source mapping resource foo');
});

test('configureConsumers', t => {
  const compiledCloudFormationTemplate = {
    Resources: {
      TestLambdaFunction: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          Role: {
            'Fn::GetAtt': ['TestLambdaRole', 'Arn']
          }
        }
      },
      Stream: {
        Type: 'AWS::Lambda::EventSourceMapping',
        Properties: {

        },
        DependsOn: 'SomethingElse'
      }
    }
  };

  const getNormalizedFunctionName = sinon.stub().returns('Test');
  const getLambdaLogicalId = sinon.stub().returns('TestLambdaFunction');
  const getStreamLogicalId = sinon.stub().returns('Stream');
  const aws = { naming: { getNormalizedFunctionName, getLambdaLogicalId, getStreamLogicalId } };
  const provider = { compiledCloudFormationTemplate };
  const service = { functions, provider }
  const getProvider = () => aws;

  const serverless = { service, getProvider };
  const plugin = new Plugin(serverless);

  return plugin.configureConsumers(compiledCloudFormationTemplate, [{
    functionLogicalId: 'TestLambdaFunction',
    functionName: 'Test',
    consumerLogicalId: 'TestConsumerStream',
    consumerName: 'TestStreamConsumer',
    streamArn: {
      'Fn::GetAtt': ['Stream', 'Arn'],
    },
    streamLogicalId: 'Stream'
  }])
    .then(() => {
      t.deepEqual(compiledCloudFormationTemplate.Resources.Stream.DependsOn, ['TestConsumerPolicy', 'SomethingElse']);
    });
});