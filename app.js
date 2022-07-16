// Initialize modules
var express = require('express'); // for handling requests at various routes
var app = express();
var bodyParser = require('body-parser'); // for parsing the request.body
const mssql = require('mssql'); // used as the database software
const http = require('http'); // for creating a http server
var server = http.createServer(app);
const io = require('socket.io')(server); // for enabling communication between server & user
const { LoremIpsum } = require("lorem-ipsum");  // for generating random filler text
const { time } = require('console');  // for accessing the current time & using utilites of that class
var striptags = require('striptags'); // for stripping html tags from strings to prevent injection
const { stringify } = require('querystring');
var sqlString = require('tsqlstring');
// Recaptcha for POST forms
const GoogleRecaptcha = require('google-recaptcha');
const googleRecaptcha = new GoogleRecaptcha({secret: '6LfJ2PQgAAAAABt3PjASNJj4C2BGaIUKA6IMbhFf'})
// Express config
app.set('views', 'views');
app.set('view engine', 'pug'); // using pug for rendering dynamnic content @ connection
app.use(express.static(__dirname));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Global variables
var timeUpdate = 5000;
var maxWordsPage = 175;
var postingCooldown = 0.1;
var pool;
var PORT = 80;
// nodejs to msSQL Connection
var sqlConfig = {
  user: 'sa',
  password: 'password',
  server: 'localhost',
  database: 'oneword',
  options: {
    trustServerCertificate: true,
  }
};
(async function () {
  try {
    console.log(getDate() + '\: Connecting to mssql server in [' + process.env.NODE_ENV + '] enviroment.');
    pool = await mssql.connect(sqlConfig);
  } catch (err) { console.log(err); }
})()

// HTTP server start listening for new connections
server.listen(PORT, '0.0.0.0', function (err) {
  if (err) console.log(err);
  console.log(getDate() + ': Server listening on PORT', PORT);
});

// Handle post cooldowns
const clientsOnCooldown = [];
setInterval(decrementCooldown, postingCooldown * 60 * 1000);
function decrementCooldown() {
  for (j = 0; j < clientsOnCooldown.length; j++) {
    if (clientsOnCooldown[j].timeLeft < 1)
      {
        clientsOnCooldown.splice(j, 1)
      }
      else {
        clientsOnCooldown[j].timeLeft--;
      }
  }
}

// Express route for getting the home page, renders the home template.
app.get('/', function (req, res) {
  getWords(null, true, res);
});

// Express route that submits input as a post to the database, performs validation
app.post('/submit-post', function (req, res) {
  let IPAddress = req.socket.remoteAddress.replace("::ffff:", "");
  let submittedWord = striptags(req.body.post);
  // Check if valid word before inserting
  if (submittedWord.search(/[^!-z]/g) != -1) { // Invalid character type
    console.log(getDate() + ': ' + IPAddress + ' INVALID CHARACTER received from ' + IPAddress + ': \'' + submittedWord + '\'');
    return res.redirect('/?error=invalid_character')
  }
  else if (submittedWord.length > 20 || submittedWord.length == 0) { // Invalid length
    console.log(getDate() + ': invalid string received from ' + IPAddress + ': \'' + submittedWord + '\'');
    return res.redirect('/?error=invalid_length')
  }
  else {
    let clientCooldown = false;
    let j = 0;
    // Check if the client posting is on a cooldown
    for (j; j < clientsOnCooldown.length; j++) {
      if (clientsOnCooldown[j].IPAddress === IPAddress) {
        clientCooldown = true;
        break;
      }
    }
    if (clientCooldown) {
      const invalidReasons = [];
      invalidReasons.push("Wait " + clientsOnCooldown[j].timeLeft + " minutes to post again.");
      let jsonResponse = {
        status: "Failure",
        reasons: invalidReasons
      };
      return res.json(jsonResponse)
    } 
    else {
      let jsonResponse = {
        status: "Success",
        reasons: ""
      };
      clientsOnCooldown.push({ IPAddress: IPAddress, timeLeft: postingCooldown });
      insertWords(IPAddress, submittedWord);
      return res.json(jsonResponse);
    }
  }
});

app.post('/submit-contact', function (req, res) {
  let nameMin = 1, subjectMin = 1, contentMin = 5, metaMax = 50, contentMax = 450;
  let IPAddress = req.socket.remoteAddress.replace("::ffff:", "");
  const invalidReasons = [];
  // Check for valid recaptcha
  const recaptchaResponse = req.body['g-recaptcha-response'];
  googleRecaptcha.verify({response: recaptchaResponse}, function(error) {
    if (error) {
      console.log("Error! Invalid captcha, debug.");
      invalidReasons.push("Invalid captcha");
    }
  })

  // Input validation on form data
  if (req.body.Name.length < nameMin)
    invalidReasons.push("Name too small");
  if (req.body.Subject.length < subjectMin)
    invalidReasons.push("Subject too small");
  if (req.body.Content.length < contentMin)
    invalidReasons.push("Content too small");
  if (req.body.Content.length > contentMax)
    invalidReasons.push("Content too large");
  let tally = 0;
  for (let k in req.body) {
    if (req.body[k].length > metaMax)
      invalidReasons.push(k + " too large");
    if (tally > 2)
      break;
    tally++;
  }

  // Valid form, insert it into database
  if (invalidReasons.length == 0) {
    (async function () {
      try {
        await pool.request().query(sqlString.format('INSERT INTO contacts (Subject, Name, Email, Business, Content) VALUES (?, ?, ?, ?, ?)', // fix all sql queries
          [req.body.Subject, req.body.Name, req.body.Email, req.body.Business, req.body.Content]));
        console.log(getDate() + ": " + IPAddress + " sent a letter");
        let jsonResponse = {
          status: "Success",
          reasons: ""
        };
        return res.json(jsonResponse);
      }
      catch (err) { console.log(err); }
    })()
  }
  else { // Invalid form, send the error back to the client
    let jsonResponse = {
      status: "Failure",
      reasons: invalidReasons
    };
    return res.json(jsonResponse);
  }
});

// Monitor for 'connection' event fired when a client connects to the homepage, sets up a data-link between the server & the client for dynamnic data
io.on('connection', function (socket) {
  console.log(getDate() + ': ' + socket.id + ' connected');
  getWords(socket.id);

  // Send new data every 30 seconds
  var activeDataLink = true;
  var interval = startWordsDataLink(socket.id, timeUpdate);

  // Listening for page changes from the client
  socket.on('pageChange', function (data) {
    (async function () {
      try {
        // Check if the page changed to is the active or one of the hosticial pages
        let pageCount = await pool.request().query('SELECT COUNT(ID) as count FROM pages')
        if (data.pageNumber == 0) {
          activeDataLink = false;
          clearInterval(interval);
        }
        else if (data.pageNumber < parseInt(pageCount.recordset[0].count + 1)) { // Render previous histoical pages
          let newPage = await pool.request().query('SELECT Content FROM pages')
          socket.emit('data', newPage.recordset[data.pageNumber - 1].Content)
          activeDataLink = false;
          clearInterval(interval);
        }
        else {  // Render current active page
          let result = await pool.request().query('SELECT content FROM words')
          let count = await pool.request().query('SELECT COUNT(ID) as count FROM words')
          const words = [];
          for (k = 0; k < count.recordset[0].count; k++) {
            words.push(result.recordset[k].content);
          }
          let combinedWords = words.join(" ");
          io.to(socket.id).emit('data', combinedWords);

          if (!activeDataLink) {// ensures no double datalinks occur
            activeDataLink = true;
            interval = startWordsDataLink(socket.id, timeUpdate)
          }
        }

      } catch (err) { console.log(err); }
    })()
  })

  // Listening for disconnect event from client
  socket.on('disconnect', function () {
    activeDataLink = false;
    clearInterval(interval);
    console.log(getDate() + ': ' + socket.id + ' disconnected');
  });
});

// Insert into the words table given IPAddress, content, and the amount of words in the content. Creates new pages if page space is exceeded
function insertWords(IPAddress, pageContent, amountWords = 1) {
  (async function () {
    for (i = 0; i < amountWords; i++) {
      try {
        if (amountWords == 1) {
          await pool.request().query(sqlString.format('INSERT INTO words (IP, content) VALUES (?, ?)', [IPAddress, pageContent]));
          console.log(getDate() + ": " + IPAddress + " wrote " + '\'' + pageContent + '\'');
        }
        else { // An array of words is inserted
          await pool.request().query(sqlString.format('INSERT INTO words (IP, content) VALUES (?, ?)', [IPAddress, pageContent[i]]));
          console.log(getDate() + ": " + IPAddress + " wrote " + '\'' + pageContent[i] + '\'');
        }

        // Checks if word limit is exceeded for the current page, if so create a new page & move the previous page contents to archives
        let content = await pool.request().query('SELECT content FROM words')
        let count = await pool.request().query('SELECT COUNT(ID) as count FROM words')
        if (count.recordset[0].count > maxWordsPage) {
          console.log(getDate() + ": New page created!")
          const words = [];
          for (k = 0; k < count.recordset[0].count; k++) {
            words.push(content.recordset[k].content);
          }

          let combinedWords = words.join(" ");
          await pool.request().query(sqlString.format('INSERT INTO pages (Content) VALUES (?)', [combinedWords]));
          await pool.request().query('DELETE FROM words') // delete all rows in words
          await pool.request().query('DBCC CHECKIDENT (N\'words\', RESEED, 0)') // reset identity seed
        }
      } catch (err) { console.log(err); }
    }
  })()
}

// Wrapper function for setInterval for sending the updated page to the client
function startWordsDataLink(id, time) {
  return setInterval(function () { getWords(id, false, null) }, time);
}

// Returns the current date in the format (DD/MM/YYYY HH:MM:SS TMZ:)
function getDate() {
  let timeNow = new Date();
  let dd = String(timeNow.getDate()).padStart(2, '0');
  let mm = String(timeNow.getMonth()).padStart(2, '0');
  let yyyy = timeNow.getFullYear();
  let hrs = String(timeNow.getHours()).padStart(2, '0');
  let mins = String(timeNow.getMinutes()).padStart(2, '0');
  let secs = String(timeNow.getSeconds()).padStart(2, '0');
  let timeZone = timeNow.toLocaleTimeString('en-us', { timeZoneName: 'short' }).split(' ')[2];
  let fullDate = dd + '/' + mm + '/' + yyyy + ' ' + hrs + ':' + mins + ':' + secs + ' ' + timeZone;
  return fullDate;
}

// Queries the database for the word list
function getWords(socketID, first, res) {
  const words = [];
  (async function () {
    try {
      // Get current list of words from database & combine them into string
      let result = await pool.request().query('SELECT content FROM words')
      let count = await pool.request().query('SELECT COUNT(ID) as count FROM words')
      for (k = 0; k < count.recordset[0].count; k++) {
        words.push(result.recordset[k].content);
      }
      let combinedWords = words.join(" ");

      // Get amount of total pages
      let pageCount = await pool.request().query('SELECT COUNT(ID) as count FROM pages')
      if (first) { // First connection/getWords, original render method for page
        res.render('index', { title: 'OneWord', messages: combinedWords, pageCount: parseInt(pageCount.recordset[0].count), postCooldown: postingCooldown, pageMaxWords: maxWordsPage });
      }
      else { // Any other query, emits data to the specific client.
        console.log(getDate() + ': Emitting to ' + socketID);
        io.to(socketID).emit('data', combinedWords);
      }
    } catch (err) { console.log(err); }
  })()
}

// Development functions //
if (process.env.NODE_ENV == 'development') {
  // Setup live-reload front-end
  var livereload = require('livereload');
  app.use(require('connect-livereload')({
    port: 35729
  }));
  var server = livereload.createServer();
  server.watch(__dirname);


  // Dev function for populating the words table as if a user is inputting them
  function populatePage(amountWords) {
    let testIP = "99.99.99";
    const lorem = new LoremIpsum({ // Config for the random word generation
      sentencesPerParagraph: {
        max: 7,
        min: 4
      },
      wordsPerSentence: {
        max: 16,
        min: 4
      }
    });
    let generatedWords = lorem.generateWords(parseInt(amountWords)).split(" ");
    insertWords(testIP, generatedWords, amountWords);
  }

  // Express route for a dev function that populates the words database with random words with amount specified via'?tagId='
  app.get('/stupd', function (req, res) {
    if (typeof req.query.tagId === 'undefined')
      populatePage(5);
    else
      populatePage(req.query.tagId);
  });
}