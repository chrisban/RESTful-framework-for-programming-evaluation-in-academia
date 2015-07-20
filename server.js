var express = require('express');
var fs = require('fs');
var app = express();
var bodyParser = require('body-parser');
var requestify = require('requestify');
var moduleVars = require('./moduleVars');

// for parsing application/json
app.use(bodyParser.json()); 

//connect static links
app.use('/js', express.static(__dirname + '/frontEnd/js'));
app.use('/css', express.static(__dirname + '/frontEnd/css'));
app.use(express.static(__dirname + '/includes'));


/*********************/
/* HTTP GET HANDLING */
/*********************/
app.get('/', function (req, res) {
 	res.sendFile( __dirname + "/frontEnd/" );
});

app.get('/includes/css/include.css', function (req, res) {
 	res.sendFile( __dirname + "/includes/css/include.css" );
});

app.get('/upload/', function (req, res) {
 	res.sendFile( __dirname + "/frontEnd/data_upload/upload.html" );
});


/***********************/
/* HTTP POST HANDLING */
/*********************/
//handle post request to retrieve datafiles
app.post('/getModule', function (req, res) {
	console.log("req: ", req.body);
	getDataFile(req, res, serveModule);
  	console.log('Served!');
});

//handle api compile requests
app.post('/compile', function (req, res) {
	//temporarily compiling via external call to api. Later on will be doing this ourselves by writing to file and executing on vm.
	requestify.post('http://rextester.com/rundotnet/api', req.body)
    .then(function(response) {
        response.getBody();
        res.type('json');  
	  	res.send(response.body);
    });
});
 
//handle answer commits
app.post('/commit', function (req, res) {
	console.log(req.body);
	//var data = getDataFile();

	if(req.body.problemType == "code")
	{
		//User's data
		var userData = {
					"LanguageChoiceWrapper": "7",
					"Program": req.body.program, //user defined code
					"input": "", //datafile defined testcase
					"compilerArgs": "-std=c++14 -o a.out source_file.cpp"
				};

		//Solution data
		var testingData = {
					"LanguageChoiceWrapper": "7",
					"Program": "",
					"input": "",
					"compilerArgs": "-std=c++14 -o a.out source_file.cpp"
				};

	//On exam finish (part one): 
	//receive committed codes via post
	//read in datafile via fs
	//loop per question -> per test case to determine score
	//write to file

	}else if(req.body.problemType == "mchoice")
	{
		
	}

	res.type('json');  
	res.send({status : "ok"});
});

app.post('/data_upload', function (req, res) {
	//TODO: handle file posting/uploading
});

//start server
var server = app.listen(8888, function () {
	var host = server.address().address;
	var port = server.address().port;
	console.log('[%s] Server listening at http://%s:%s',  __dirname, host, port);
});




function getDataFile(req, res, callback)
{
	var file = __dirname + '/dataFiles/data' + req.body.test_id + '.json';
	var data = { result: "Server file load error!"};

	fs.readFile(file, 'utf8', function (err, datafile) {
		if (err) {
			console.log('E: ' + err);
			return;
		}
		//parse and return
		data = JSON.parse(datafile);
		callback(req, res, data);
	});
}

function serveModule(req, res, data)
{
	var html = "";

	//get exported template data from moduleVars.js
	var header = moduleVars.header; //Overall page header information/instructions
	var requires = moduleVars.requires; //all css/js/etc. includes
	var pStatementTemplate = moduleVars.pStatementTemplate; //problemstatement template structure. Has placeholders to be changed in forloop below.
	
	//programming specific template vars
	var ioTemplate = moduleVars.ioTemplate; //code and input template structure. Has placeholders to be changed in forloop below.
	var navTemplate = moduleVars.navTemplate; //template that holds the nav elements used to switch between exam questions
	
	//multChoice specific template vars
	var mcCodeTemplate = moduleVars.mcCodeTemplate; //template that holds code editor for mchoice questions
	var mcOptionTemplate = moduleVars.mcOptionTemplate; //template that holds the skeleton for each mchoice option
	var mcClose = moduleVars.mcClose; // closes div tags that could not be closed until multiple iterations had been inserted.
	
	//script to be evald on client side
	var editorInit = moduleVars.editorInit; //function call to be appended per editor instance to init
	var script = moduleVars.script; //all listeners and js code to be evald once client has received

		//Decide which module to serve
	if(req.body.type == 'exam')
	{
		html = '<!--BEGIN module code-->' + requires + header;

		//iterate through each question in exam datafile, replacing placeholders with index and datafile specefied information
		for(var i = 0; i < Object.keys(data).length; i++)
		{
			//if question type is a programming question (type: "code")
			if(data[i]["questionType"] == "code")
			{
				html += pStatementTemplate.replace(/<<n>>/g, i).replace(/<<pstatement>>/, data[i]["problem"]) + ioTemplate.replace(/<<n>>/g, i).replace(/<<code>>/, data[i]["skeleton"]);
				script += editorInit.replace(/<<n>>/g, i).replace(/<<lang>>/g, data[i]["language"]);
			}
			//if question type is a programming question (type: "mchoice")
			else if(data[i]["questionType"] == "mchoice")
			{
				html += pStatementTemplate.replace(/<<n>>/g, i).replace(/<<pstatement>>/, data[i]["problem"]) + mcCodeTemplate.replace(/<<n>>/g, i).replace(/<<code>>/, data[i]["skeleton"]);;
				script += editorInit.replace(/<<n>>/g, i).replace(/<<lang>>/g, data[i]["language"]);

				//iterate through each multiple choice supplied in the datafile per question
				for(var j = 0; j < data[i]["test_input"].length; j++)
				{	
					html+= mcOptionTemplate.replace(/<<mc>>/g, data[i]["test_input"][j]).replace(/<<o>>/g, j).replace(/<<n>>/g, i);
				}

				html+= mcClose;
			}	
		}

		html += navTemplate + '<!--END module code-->';
	}
	else if(req.body.type == 'book')
	{
		//TODO: proof of concept code for book module
	}

	//send object
	res.type('json');
	res.send( {response_html : html, response_script: script} );
}