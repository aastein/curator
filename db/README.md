## Set up a mondo db in this directory
# Add Instagram credentials to the db
  db.credentials.insert({"username":"aUserName","password":"aPassword"})
# Add cookies dir to the db
  db.config.insert({"storage":"../cookies"})
# Add message thread name to the db
  db.config.insert({"threadName":"direct message thread name"})
