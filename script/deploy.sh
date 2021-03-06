#!/bin/bash
set -eo pipefail
ARTIFACT_BUCKET=$(cat bucket-name.txt)
if [[ $# -gt 0 ]] && [[ $1 == 'api' ]]
then
  aws cloudformation package --template-file template-with-api.yml --s3-bucket $ARTIFACT_BUCKET --output-template-file out.yml
  aws cloudformation deploy --template-file out.yml --stack-name blank-api-nodejs --capabilities CAPABILITY_NAMED_IAM
else 
  aws cloudformation package --template-file template.yml --s3-bucket $ARTIFACT_BUCKET --output-template-file out.yml
  aws cloudformation deploy --template-file out.yml --stack-name blank-nodejs-1 --capabilities CAPABILITY_NAMED_IAM
fi
