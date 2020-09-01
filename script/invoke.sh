#!/bin/bash
set -eo pipefail
FUNCTION=$(aws cloudformation describe-stack-resource --stack-name blank-nodejs --logical-resource-id function --query 'StackResourceDetail.PhysicalResourceId' --output text)

echo $FUNCTION

while true; do
  aws lambda invoke --function-name $FUNCTION --payload fileb://event.json out.json
  cat out.json
  echo ""
  sleep 5
done
