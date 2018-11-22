'use strict';

const aws = require('aws-sdk');
const helper = require('lambda-cloudformation-resource');

const kinesis = new aws.Kinesis();

const backoff = count => new Promise(resolve => {
  const timeout = Math.pow(count, 2) * 1000;
  setTimeout(resolve, timeout);
});

function waitForActive(consumer, attempt = 1) {
  const params = { ConsumerARN: consumer.ConsumerARN };  

  return kinesis.describeStreamConsumer(params).promise()
    .then(response => {
      if (response.ConsumerDescription.ConsumerStatus === 'ACTIVE') {
        return consumer;
      }
      return backoff(attempt).then(() => waitForActive(consumer, attempt + 1))
    });
}

function waitForDelete(params, attempt = 1) {
  return kinesis.describeStreamConsumer(params).promise()
    .then(() => {
      return backoff(attempt).then(() => waitForDelete(params, attempt + 1))
    })
    .catch(e => {
      if (e.code === 'ResourceNotFoundException') {
        return;
      }
      throw e;
    });
}

module.exports.handler = helper(event => {
  return Promise.resolve()
    .then(() => {
      const consumerName = event.ResourceProperties.ConsumerName;
      const streamARN = event.ResourceProperties.StreamARN;
      const params = { ConsumerName: consumerName, StreamARN: streamARN };

      switch (event.RequestType) {
        case 'Create':
          return kinesis.registerStreamConsumer(params).promise()
            .then(response => waitForActive(response.Consumer));
        case 'Delete':
          return kinesis.deregisterStreamConsumer(params).promise()
            .then(() => waitForDelete(params));
        default:
          console.log(`Skipping RequestType: ${event.RequestType}`);
          return Promise.resolve();
      }
  });
});