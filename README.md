# serverless-plugin-kinesis-consumer

Lambda support for Kinesis enhanced fan-out has been released but without CloudFormation support.

Until then, this plugin uses Lambda-backed CloudFormation Custom Resources to configure things for you.

## Usage

Add `consumer` to your Kinesis stream event mapping:

```yml
functions:
  hello:
    events:
      - stream:
          type: kinesis
          consumer: true # will auto-generate a name for the consumer
          arn: ...
      - stream:
          type: kinesis
          consumer: customConsumerName
          arn: ...
```

This is the only configuration necessary. Keep in mind ehanced fan-out has additional costs.