'use strict';

require('babelify-es6-polyfill');
const fs = require('fs');
const request = require('request');
const schedule = require('node-schedule');
const instagram = require('instagram-private-api');
const MongoClient = require('mongodb').MongoClient
const assert = require('assert');

const dbUrl = 'mongodb://localhost:27017/curator';
const credentialPath = 'config/credentials.json';

var Client = instagram.V1;
var storage;
var device;

var config;
var username;
var password;
var storagePath;
var threadName;
var session;
var inboxFeed;
var thread;
var threadFeed;

var newImageUrls;
var postedImageUrls;
var unpostedImageUrls;

var filePaths = [];

function setCredentials(){
  return new Promise((resolve, reject) => {
    MongoClient.connect(dbUrl, (err, db) => {
      assert.equal(null, err);
//      console.log("Connected successfully to server");
      var col = db.collection('credentials');
      var data = col.find({}).toArray((err, data) => {
//        console.log("Setting credentials");
//        console.log(data[0]);
        username = data[0].username;
        password = data[0].password;
//        console.log("Set credentials");
        db.close();
//        console.log("Disconnected from server");
        resolve();
      });
    });
  });
}

function setStoragePath(){
  storagePath = config.filter((record) => {
    return record.storage != null;
  });
}

function setThreadName(){
  threadName = config.find((record) => {
    return record.threadName != null;
  }).threadName.replace(/\s/g, " ");
}

function setConfig(){
  return new Promise((resolve, reject) => {
    MongoClient.connect(dbUrl, (err, db) => {
      assert.equal(null, err);
//      console.log("Connected successfully to server");
      var col = db.collection('config');
      var data = col.find({}).toArray((err, data) => {
//        console.log("Setting config");
        config = data;
//        console.log("Set config: ", config);
        db.close();
//        console.log("Disconnected from server");
        resolve();
      });
    });
  });
}

function setup(){
  return new Promise((resolve, reject) => {
      setConfig().then(() => {
        setStoragePath();
        setThreadName();
      }).then(setCredentials().then(() => {
        resolve();
      }));
  });
}

function setSession(){
  return new Promise((resolve, reject) => {
//    console.log("Setting session");
    device = new Client.Device(username);
    storage = new Client.CookieFileStorage(storagePath + username + '.json');
    Client.Session.create(device, storage, username, password).then((s) => {
     		session=s;
//        console.log("Session set");
        resolve(true);
  	});
  });
}

function setInboxFeed(){
  return new Promise((resolve, reject) => {
  //  console.log("Getting inbox feed")
    new Client.Feed.Inbox(session, 100).get().then((feed) => {
  //    console.log("Setting inbox feed", feed);
      inboxFeed = feed;
  //    console.log("Set inbox feed");
      resolve();
    });
  });
}

function setThreadWithName(){
  //console.log("Finding thread with name:", threadName);
  thread = inboxFeed.find((thread) => {
      return thread._params.title === threadName;
  });
}

function setThreadItemFeed(){
  return new Promise((resolve, reject) => {
    new Client.Feed.ThreadItems(session, thread.id, 100).get().then((feed) => {
      //console.log("Setting thread feed", feed);
      threadFeed = feed;
      //console.log("Set thread items feed");
      resolve();
    });
  });
}

function getNewImageUrls(){
  newImageUrls = threadFeed.filter((item) => {
    return item.getParams().mediaShare != null;
  }).filter((item) => {
    return item.getParams().mediaShare.mediaType == 1;
  }).filter((item) => {
    return item.getParams().mediaShare.images[0] != null;
  }).filter((item) => {
    return item.getParams().mediaShare.images[0].url != null;
  }).map((item) => {
    return item.getParams().mediaShare.images[0].url;
  });
}

function getPostedImageUrls(){
  return new Promise((resolve, reject) => {
    MongoClient.connect(dbUrl, (err, db) => {
      assert.equal(null, err);
      var col = db.collection('images');
      var data = col.find({}).toArray((err, data) => {
        postedImageUrls = data[0].urls;
        db.close();
        resolve();
      });
    });
  });
}

function getUnpostedImageUrls(){
  unpostedImageUrls = newImageUrls.filter((url) => {
    return true;
  })
}

function downloadImageByUrl(url){
  return new Promise((resolve, reject) => {
    var filename = 'temp/' + new Date().getTime() + '.jpg';
    filePaths.push(filename);
    console.log("downloading: ", filename);
    request.head(url, function(err, res, body){
      console.log('content-type:', res.headers['content-type']);
      console.log('content-length:', res.headers['content-length']);
      request(url).pipe(fs.createWriteStream(filename)).on('close', () => {
        resolve();
      });
    });
  });
}

function downloadImagesByUrl(){
  return new Promise((resolve, reject) => {
    console.log("Downloading images by url");
    var promiseImages = unpostedImageUrls.map((url) => {
        console.log("url:", url);
        return downloadImageByUrl(url);
    });
    console.log("init Promises");
    Promise.all(promiseImages).then(() => {
      resolve();
    });
  });
}

function postImages(){
  filePaths.forEach((path) => {
    console.log("uploading image:", path);
    new Client.Upload.photo(session, path).then((upload) => {
  		console.log(upload.params.uploadId);
  		return new Client.Media.configurePhoto(session, upload.params.uploadId, 'akward caption');
  	})
  	.then((medium) => {
  		console.log(medium.params)
  	})
  });
}

function recordPostedImages(){
  
}

function main(){
  setup().then(() => {
    setSession().then(() => {
      setInboxFeed().then(() => {
        setThreadWithName();
        setThreadItemFeed().then(() => {
            getNewImageUrls();
            getPostedImageUrls().then(() => {
              getUnpostedImageUrls();
              downloadImagesByUrl().then(() => {
                console.log("downloaded images");
                postImages().then(() => {
                  console.log("posted images");
                  recordPostedImages();
                });
              })
            });
        });
      });
    });
  });
}

main();