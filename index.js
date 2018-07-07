const client = require('mongodb').MongoClient;
const AWS = require('aws-sdk');
const client_secrets_manager = new AWS.SecretsManager();

exports.handler = (event, context) => {
  console.log(event);
  
  const step = event.Step;
  const token = event.ClientRequestToken;
  const arn = event.SecretId;

  switch(step) {
    case 'createSecret': create_secret(client_secrets_manager, arn, token); break;
    case 'setSecret': set_secret(client_secrets_manager, arn); break;
    case 'testSecret': test_secret(client_secrets_manager, arn); break;
    case 'finishSecret': finish_secret(client_secrets_manager, arn, token); break;
  }
};

async function create_secret(client_secrets_manager, arn, token) {
  let params = {
    PasswordLength: 32, 
    ExcludePunctuation: true
  };
  
  let data = await client_secrets_manager.getRandomPassword(params).promise();
  const password = data.RandomPassword;
  
  console.log("RETRIEVED RANDOM PASSWORD");
  console.log(data);
  
  params = {
    SecretId: arn,
    VersionStage: 'AWSCURRENT',
  };

  data = await client_secrets_manager.getSecretValue(params).promise();
  const current_dict = JSON.parse(data['SecretString']);
  
  console.log("RETRIEVED CURRENT SECRET");
  console.log(data);

  // switch the ACTIVE/PASSIVE usernames around for the new secret
  const username = current_dict['username'] == 'app' ? 'app_clone' : 'app';

  // we'll need to store the masterarn and ipaddress as well for future rotations
  const new_secret = {
    'username': username,
    'password': password,
    'masterarn': current_dict['masterarn'],
    'ipaddress': current_dict['ipaddress'],
  };
  
  params = {
    SecretId: arn,
    SecretString: JSON.stringify(new_secret),
    VersionStages: ['AWSPENDING'],
    ClientRequestToken: token,
  };

  data = await client_secrets_manager.putSecretValue(params).promise();
  
  console.log("PUT PENDING SECRET");
  console.log(data);
}

async function set_secret(client_secrets_manager, arn) {
  let params = {
    SecretId: arn,
    VersionStage: 'AWSPENDING',
  };
  
  let data = await client_secrets_manager.getSecretValue(params).promise();
  const pending_dict = JSON.parse(data['SecretString']);
  
  console.log("RETRIEVED PENDING SECRET");
  console.log(data);
  
  params = {
    SecretId: pending_dict['masterarn'],
    VersionStage: 'AWSCURRENT',
  };
  
  data = await client_secrets_manager.getSecretValue(params).promise();
  const master_dict = JSON.parse(data['SecretString']);
  
  console.log("RETRIEVED MASTER SECRET");
  console.log(data);

  client.connect(`mongodb://${master_dict['username']}:${master_dict['password']}@${pending_dict['ipaddress']}:27017`, (err, client) => {

    const db = client.db('admin');
    
    db.command({
      updateUser: pending_dict['username'],
      pwd: pending_dict['password']
    }, (err, res) => {
      console.log("CHANGED PASSWORD IN MONGODB");
      console.log(res);
    });
    
    client.close();
  });
}

async function test_secret(client_secrets_manager, arn) {
  const params = {
    SecretId: arn,
    VersionStage: 'AWSPENDING',
  };
  
  const data = await client_secrets_manager.getSecretValue(params).promise();
  const pending_dict = JSON.parse(data['SecretString']);
  
  console.log("RETRIEVED PENDING SECRET");
  console.log(data);
  
  client.connect(`mongodb://${pending_dict['username']}:${pending_dict['password']}@${pending_dict['ipaddress']}:27017`, (err, client) => {
    console.log('TEST OK');
    client.close();
  });
}

async function finish_secret(client_secrets_manager, arn, token) {
  let params = {
    SecretId: arn,
    VersionStage: 'AWSCURRENT',
  };
  
  let data = await client_secrets_manager.getSecretValue(params).promise();
  const version_id = data['VersionId'];
  
  console.log("RETRIEVED CURRENT SECRET");
  console.log(data);

  params = {
    SecretId: arn,
    VersionStage: 'AWSCURRENT',
    MoveToVersionId: token,
    RemoveFromVersionId: version_id,
  };
  
  data = await client_secrets_manager.updateSecretVersionStage(params).promise();
  
  console.log("PROMOTED PENDING SECRET TO CURRENT");
  console.log(data);
}
