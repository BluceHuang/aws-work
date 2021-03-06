/*
 * @Description: aws lambda function for accept csv data and write to dynamodb
 * @Author: BluceHuang
 * @Email: 2818704605@qq.com
 * @Date: 2020-09-01 00:54:54
 * @LastEditTime: 2020-09-25 21:49:52
 * @LastEditors: BluceHuang
 */
const AWS = require("aws-sdk");
const parse = require("csv-parse/lib/sync");
const md5 = require("md5-node");
const stringify = require("json-stringify-safe");

AWS.config.region = "ap-east-1";
const s3 = new AWS.S3();
const sns = new AWS.SNS();
const docClient = new AWS.DynamoDB.DocumentClient();

const columns = ["latitude", "longitude", "address"];
columns.sort();
const LATITUDE = "latitude";
const LONGITUDE = "longitude";

const { tableName, snsTopicArn, batchWriteSize } = require("./config");
const { WriteDbError, InvalidDataError } = require("./error");

/**
 * @description: check csv data
 * @Author: BluceHuang
 * @param : data: Buffer or String
 * @return csv data array or throw error
 */
exports.checkCsvData = (data) => {
  const records = parse(data, {
    columns: true,
    skip_empty_lines: true,
    delimiter: ",",
  });

  // console.log(JSON.stringify(records));

  // check data is empty or not
  if (!Array.isArray(records) || records.length === 0) {
    throw "csv data format error";
  }

  // check clumns
  const dataColumns = Object.keys(records[0]);
  if (columns.length != dataColumns.length) {
    throw "csv data error, clumn length mismatch";
  }
  dataColumns.sort();
  for (let i = 0; i < columns.length; i++) {
    if (columns[i] !== dataColumns[i]) {
      throw "csv data error, column name mismatch";
    }
  }
  return records;
};

function responseSuccess() {
  const response = {
    statusCode: 0,
    body: JSON.stringify({}),
  };
  return response;
}

/**
 * @description: provide batch write request data
 * @Author: BluceHuang
 * @param : records, offset, size
 * @return DocumentClient.BatchWriteItemInput
 */
exports.getBatchWriteData = (records, offset, size) => {
  const requestParams = {
    RequestItems: {},
  };
  requestParams.RequestItems[tableName] = [];
  for (let j = 0; j < size; j++) {
    const id = md5(JSON.stringify(records[offset + j]));
    records[offset + j][LATITUDE] = parseFloat(records[offset + j][LATITUDE]);
    records[offset + j][LONGITUDE] = parseFloat(records[offset + j][LONGITUDE]);
    requestParams.RequestItems[tableName].push({
      PutRequest: { Item: Object.assign({ id }, records[offset + j]) },
    });
  }
  return requestParams;
};

async function publishSnsMessage(msg) {
  const params = {
    Message: msg,
    TopicArn: snsTopicArn,
  };

  try {
    const result = await sns.publish(params).promise();
    console.log(`Message ${msg} send sent to the topic ${params.TopicArn}`);
    console.log("MessageID is " + result.MessageId);
  } catch (err) {
    console.error(`publish sns message fail, ${JSON.stringify(err)}`);
  }
}

async function getCsvDataFromS3Event(event) {
  const srcBucket = event.Records[0].s3.bucket.name;
  const srcKey = decodeURIComponent(
    event.Records[0].s3.object.key.replace(/\+/g, "")
  );

  // Infer the csv type from the file suffix.
  const typeMatch = srcKey.match(/\.([^.]*)$/);
  if (!typeMatch) {
    throw "Could not determine the csv type.";
  }

  // Check that the csv type is supported
  const csvType = typeMatch[1].toLowerCase();
  if (csvType !== "csv") {
    throw `Unsupported file type`;
  }

  const s3Data = await s3
    .getObject({ Bucket: srcBucket, Key: srcKey })
    .promise();
  console.log(JSON.stringify(s3Data));
  return s3Data.Body;
}

function getCsvDataFromApiEvent(event) {
  if (typeof event.body === "string") {
    return event.body;
  } else if (event.body) {
    return stringify(event.body);
  }

  throw "exception api request, no body data";
}

exports.getCsvData = async (event) => {
  if (event.Records) {
    return await getCsvDataFromS3Event(event);
  } else {
    return await getCsvDataFromApiEvent(event);
  }
};

function responseError(errCode, msg) {
  const response = {
    statusCode: errCode,
    body: JSON.stringify(msg),
  };
  return response;
}

async function handleError(errCode, errMsg) {
  await publishSnsMessage(errMsg);
  return responseError(errCode, errMsg);
}

/**
 * @description: lambda function entry
 * @Author: BluceHuang
 * @param : event
 * @return {statusCode, body}
 */
exports.handler = async (event) => {
  console.log(`receive this event ${JSON.stringify(event)}`);

  try {
    const csvData = await this.getCsvData(event);
    let records = null;
    try {
      records = this.checkCsvData(csvData);
    } catch (err) {
      return await handleError(InvalidDataError, err);
    }

    const total = records.length;
    const loopTotal = Math.ceil(total / batchWriteSize);

    for (let i = 0; i < loopTotal; i++) {
      const offset = i * batchWriteSize;
      const handleSize = i < loopTotal - 1 ? batchWriteSize : total - offset;
      const requestParams = this.getBatchWriteData(records, offset, handleSize);
      console.log("write to dynamodb ...");
      const result = await docClient.batchWrite(requestParams).promise();
      if (
        result.UnprocessedItems &&
        result.UnprocessedItems[tableName] &&
        result.UnprocessedItems[tableName].length > 0
      ) {
        const errMsg = `${tableName} unprocess data ${JSON.stringify(
          result.UnprocessedItems
        )}`;
        console.error(errMsg);
        return await handleError(WriteDbError, errMsg);
      }
    }
  } catch (err) {
    const errMsg = `${JSON.stringify(err)}`;
    return await handleError(WriteDbError, errMsg);
  }

  return responseSuccess();
};
