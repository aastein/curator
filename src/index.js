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
      console.log("Connected successfully to db");
      console.log("Setting credentials");
      var col = db.collection('credentials');
      var data = col.find({}).toArray((err, data) => {
        username = data[0].username;
        password = data[0].password;
        console.log("Set credentials");
        db.close();
        console.log("Disconnected from db");
        resolve();
      });
    });
  });
}

function setStoragePath(){
  storagePath = config.filter((record) => {
    return record.storage != null;
  });
  console.log("Set storage path to:", storagePath);
}

function setThreadName(){
  threadName = config.find((record) => {
    return record.threadName != null;
  }).threadName.replace(/\s/g, " ");
  console.log("Set threadName to:", threadName);
}

function setConfig(){
  return new Promise((resolve, reject) => {
    MongoClient.connect(dbUrl, (err, db) => {
      assert.equal(null, err);
      console.log("Connected successfully to db");
      console.log("Setting config");
      var col = db.collection('config');
      var data = col.find({}).toArray((err, data) => {
        config = data;
        db.close();
        console.log("Disconnected from db");
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
    console.log("Setting session");
    device = new Client.Device(username);
    storage = new Client.CookieFileStorage(storagePath + username + '.json');
    Client.Session.create(device, storage, username, password).then((s) => {
     		session=s;
        console.log("Set session");
        resolve(true);
  	});
  });
}

function setInboxFeed(){
  return new Promise((resolve, reject) => {
    console.log("Setting inbox feed")
    new Client.Feed.Inbox(session, 100).get().then((feed) => {
      inboxFeed = feed;
      console.log("Set inbox feed");
      resolve();
    });
  });
}

function setThreadWithName(){
  console.log("Setting thread by name:", threadName);
  thread = inboxFeed.find((thread) => {
      return thread._params.title === threadName;
  });
  console.log("Set thread");
}

function setThreadItemFeed(){
  return new Promise((resolve, reject) => {
    console.log("Setting thread items feed from feed");
    new Client.Feed.ThreadItems(session, thread.id, 100).get().then((feed) => {
      threadFeed = feed;
      console.log("Set thread items feed");
      resolve();
    });
  });
}

function getNewImageUrls(){
  console.log("Setting new image urls");
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
  console.log("Set new image urls:", newImageUrls);
}

function getPostedImageUrls(){
  return new Promise((resolve, reject) => {
    MongoClient.connect(dbUrl, (err, db) => {
      assert.equal(null, err);
      console.log("Connected successfully to db");
      console.log("Getting posted image urls");
      var col = db.collection('images');
      var data = col.find({}).toArray((err, data) => {
        postedImageUrls = data.map((d) => {
          return d.url;
        });
        db.close();
        console.log("Disconnected from db");
        resolve();
      });
    });
  });
}

function getUnpostedImageUrls(){
  unpostedImageUrls = newImageUrls.filter((url) => {
    console.log("Already posted:", postedImageUrls.includes(url))
    return !postedImageUrls.includes(url);
  })
  console.log("Set unposteed image urls:", unpostedImageUrls);
}

function downloadImageByUrl(url){
  return new Promise((resolve, reject) => {
    console.log("Downloading image by url:", url);
    var filename = 'temp/' + new Date().getTime() + '.jpg';
    filePaths.push(filename);
    request.head(url, function(err, res, body){
      request(url).pipe(fs.createWriteStream(filename)).on('close', () => {
        console.log("Downloaded image");
        resolve();
      });
    });
  });
}

function downloadImagesByUrl(){
  return new Promise((resolve, reject) => {
    console.log("Downloading images");
    var promiseImages = unpostedImageUrls.map((url) => {
        console.log("url:", url);
        return downloadImageByUrl(url);
    });
    Promise.all(promiseImages).then(() => {
      console.log("Downloaded images");
      resolve();
    });
  });
}

function postImage(path){
  return new Promise((resolve, reject) => {
    new Client.Upload.photo(session, path).then((upload) => {
      console.log("Posting image:", path);
      return new Client.Media.configurePhoto(session, upload.params.uploadId, '');
    })
    .then((medium) => {
      console.log("Posted image");
      resolve();
    })
  });
}

function postImages(){
  return new Promise((resolve, reject) => {
    var promiseUploads = filePaths.map((path) => {
        console.log("Path:", path);
        return postImage(path);
    });
    Promise.all(promiseUploads).then(() => {
      console.log("Posted images");
      resolve();
    });
  });
}

function recordPostedUrl(url){
  return new Promise((resolve, reject) => {
    MongoClient.connect(dbUrl, (err, db) => {
      assert.equal(null, err);
      console.log("Connected successfully to db");
      console.log("Recording posted image url");
      var col = db.collection('images');
      col.insertOne({"url":url}, (err, r) => {
        assert.equal(null, err);
        assert.equal(1, r.insertedCount);
        console.log("Disconnected from db");
        db.close();
        resolve();
      });
    });
  });
}

function recordPostedUrls(){
  return new Promise((resolve, reject) => {
    console.log("Recording posted image urls");
    var promiseInserts = unpostedImageUrls.map((url) => {
        return recordPostedUrl(url);
    });
    Promise.all(promiseInserts).then(() => {
      console.log("Recorded posted image urls");
      resolve();
    });
  });
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
              postImages().then(() => {
                recordPostedUrls().then(() => {
                  console.log("Done");
                });
              });
            })
          });
        });
      });
    });
  });
}

main();
