'use strict';

require('babelify-es6-polyfill');
const fs = require('fs');
const request = require('request');
const schedule = require('node-schedule');
const instagram = require('instagram-private-api');
const MongoClient = require('mongodb').MongoClient
const assert = require('assert');
const dbUrl = 'mongodb://localhost:27017/curator';

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
var newImagePosts = [];
var postedImageUrls;
var unpostedImagePosts;

// Read credentials from the database and set credential variables
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

// Set the storeage path from the value specified the config object
function setStoragePath(){
  storagePath = config.filter((record) => {
    return record.storage != null;
  });
  console.log("Set storage path to:", storagePath);
}

// Set the name of the group chat or message thread specifiedin the config object
function setThreadName(){
  threadName = config.find((record) => {
    return record.threadName != null;
  }).threadName.replace(/\s/g, " ");
  console.log("Set threadName to:", threadName);
}

// Reads the config from the database sets the config object
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

// Sets up the credentials and configurations
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

// Sets the instagram session. This is eqivalent to logging in
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

// Sets the inboxFeed. The inboxFeed is the users inbox.
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

// Finds the correct thread in the inboxFeed. This is eqivalent to finding the
// group chat or message thread by the title of the group chat or message thread
// in the users inbox.
function setThreadWithName(){
  console.log("Setting thread by name:", threadName);
  thread = inboxFeed.find((thread) => {
      return thread._params.title === threadName;
  });
  console.log("Set thread");
}

// Gets the threadItems feed from the thread. This is equivalent to getting the
// messages in the group chat or message thread.
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

// Gets only messages in the thread which are shared images.
// Each imagePost has a url of the image and the username of the original poster
function getnewImagePosts(){
  console.log("Setting new image posts");
  var index = 0;

  // Index the messages in the feed
  threadFeed = threadFeed.map((item) => {
    item.curatorIndex = index;
    index ++;
    return item;
  });

  newImagePosts = threadFeed.filter((item) => {
    return item.getParams().mediaShare != null;
  }).filter((item) => {
    return item.getParams().mediaShare.mediaType == 1;
  }).filter((item) => {
    return item.getParams().mediaShare.images[0] != null;
  }).filter((item) => {
    return item.getParams().mediaShare.images[0].url != null;
  }).map((item) => {
    var imagePost = {};
    imagePost.url = item.getParams().mediaShare.images[0].url;
    imagePost.sourceName = item.getParams().mediaShare.account.username;
    imagePost.index = item.curatorIndex;
    imagePost.comment = '';
    return imagePost;
  });

  // Add subsequent text message as imagePost comment
  newImagePosts = newImagePosts.map((imagePost) => {
    if(imagePost.index > 0 && threadFeed[imagePost.index - 1] != null){
      var nextPost = threadFeed[imagePost.index - 1];
      if(nextPost.getParams().type === 'text'){
        imagePost.comment = nextPost.getParams().text;
      }
    }
    return imagePost;
  });

  console.log("Set new image posts");
}

// Reads previously posted urls from the databse and stores the value in postedImageUrls
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

// Filters the list of newImagePosts for posts which have urls that are not in
// the postedImageUrls object.
function getUnpostedImagePosts(){
  unpostedImagePosts = newImagePosts.filter((imagePost) => {
    console.log("Already posted:", postedImageUrls.includes(imagePost.url))
    return !postedImageUrls.includes(imagePost.url);
  })
  console.log("Set unposteed image urls:", unpostedImagePosts);
}

// Downloads an imagePost by the imagePosts url and the file path of the imagePost
// The file path is added to an imagePost in downloadImagePosts() before invoking
// this method.
function downloadImagePost(imagePost){
  return new Promise((resolve, reject) => {
    var url = imagePost.url;
    var filePath = imagePost.filePath;
    console.log("Downloading image by url:", url);
    request.head(url, function(err, res, body){
      request(url).pipe(fs.createWriteStream(filePath)).on('close', () => {
        console.log("Downloaded image");
        resolve();
      });
    });
  });
}

// For each unpostedImagePost this method sets a download path for the imagePost
// then downloads the image specified by the imagePost
function downloadImagePosts(){
  return new Promise((resolve, reject) => {
    console.log("Downloading images");

    // Set download paths for each imagePost
    unpostedImagePosts = unpostedImagePosts.map((imagePost) => {
      var filePath = 'temp/' + new Date().getTime() + '.jpg';
      imagePost.filePath = filePath;
      return imagePost;
    });

    // Download all unpostedImagePosts
    var promiseImages = unpostedImagePosts.map((imagePost) => {
      console.log("url:", imagePost.url);
      return downloadImagePost(imagePost);
    });
    Promise.all(promiseImages).then(() => {
      console.log("Downloaded images");
      resolve();
    });
  });
}

// Posts the image specifed in the imagePost .The minimum comment is a tag of
// the original poster.
function postImage(imagePost){
  return new Promise((resolve, reject) => {
    var path = imagePost.filePath;
    var source = 'source: @' + imagePost.sourceName;
    var comment = imagePost.comment != '' ? imagePost.comment + '. ' + source : source;
    // Uploads and posts the image to Instagram
    new Client.Upload.photo(session, path).then((upload) => {
      console.log("Posting image:", path);
      return new Client.Media.configurePhoto(session, upload.params.uploadId, comment);
    })
    .then((medium) => {
      console.log("Posted image");
      resolve();
    })
  });
}

// Posts all images in the unpostedImagePosts
function postImages(){
  return new Promise((resolve, reject) => {
    // Post the images
    var promiseUploads = unpostedImagePosts.map((imagePost) => {
        console.log("Path:", imagePost.filePath);
        return postImage(imagePost);
    });
    Promise.all(promiseUploads).then(() => {
      console.log("Posted images");
      resolve();
    });
  });
}

// Writes the url of a newly posted image to the database so that it will not
// be posted again.
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

// Writes the url of all newly posted images to the database so they will noy
// be posted again.
function recordPostedUrls(){
  return new Promise((resolve, reject) => {
    console.log("Recording posted image urls");
    var promiseInserts = unpostedImagePosts.map((imagePost) => {
        return recordPostedUrl(imagePost.url);
    });
    Promise.all(promiseInserts).then(() => {
      console.log("Recorded posted image urls");
      resolve();
    });
  });
}

// Runs all the things
function main(){
  setup().then(() => {
    setSession().then(() => {
      setInboxFeed().then(() => {
        setThreadWithName();
        setThreadItemFeed().then(() => {
          getnewImagePosts();
          getPostedImageUrls().then(() => {
            getUnpostedImagePosts();
            downloadImagePosts().then(() => {
              postImages().then(() => {
                recordPostedUrls().then(() => {
                  console.log("Done");
                });
              });
            });
          });
        });
      });
    });
  });
}

// Entry point
main();
