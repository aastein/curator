# curator

curator is a node app that reposts images and video from a message thread on Insagram to an instagram account.

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
- Create a table for the app
  - use curator
- Add Instrgram credentials to the db
  - db.credentials.insert({"username":"aUserName","password":"aPassword"})
- Add cookies directroy to the db
  - db.config.insert({"storage":"../cookies"})
- Add message thread name to the db
  - db.config.insert({"threadName":"direct message thread name"})

## Usage

- Share dank memes in a named group chat
- Run by command line
  - npm start
- Watch as the dank memes are automatically reposted
- Each run looks at the last 100 messages in the message thread
