'use strict';

const aws = require('aws-sdk');
const helper = require('lambda-cloudformation-resource');

const kinesis = new aws.Kinesis();

function waitForActive(consumer, attempt = 1) {
  const params = {
    ConsumerARN: consumer.ConsumerARN
  };

  return kinesis.describeStreamConsumer(params).promise()
    .then(response => {
      if (response.ConsumerDescription.ConsumerStatus === 'ACTIVE') {
        return consumer;
      }
      return new Promise(resolve => {
        const timeout = Math.pow(attempt, 2) * 1000;
        console.log('Consumer is not active yet - waiting', timeout, 'ms before checking again');
        setTimeout(resolve, timeout);
      })
      .then(() => {
        return waitForActive(consumer, attempt + 1);
      });
    });
}

module.exports.handler = helper(event => {
  return Promise.resolve()
    .then(() => {
      const consumerName = event.ResourceProperties.ConsumerName;
      const streamARN = event.ResourceProperties.StreamARN;
      
      const params = {
        ConsumerName: consumerName,
        StreamARN: streamARN
      };

      switch (event.RequestType) {
        case 'Create':
          return kinesis.registerStreamConsumer(params).promise()
            .then(response => {
              return waitForActive(response.Consumer);
            });
        case 'Update':
          return Promise.resolve('Nothing to do for Update');
        case 'Delete':
          return kinesis.deregisterStreamConsumer(params).promise()
            .then(() => {});
        default:
          return Promise.resolve(`Skipping unknown RequestType: ${event.RequestType}`);
      }
  });
});