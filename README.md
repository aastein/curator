# curator

curator is a node app that reposts images from a message thread on Insagram to an instagram account.

## Setup

- Clone this repository
- Install node
  - npm install
- Get mongodb
  - brew update
  - brew install mongodb
- Initialize a db in the db directory
  - mongod --dbpath db
- Go to mongodb command line
    - mongo
- Add Instrgram credentials to the db
  - db.credentials.insert({"username":"aUserName","password":"aPassword"})
- Add cookies directroy to the db
  - db.config.insert({"storage":"../cookies"})
- Add message thread name to the db
  - db.config.insert({"threadName":"direct message thread name"})
