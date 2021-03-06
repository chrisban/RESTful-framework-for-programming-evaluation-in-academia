/*File comments*/
var fs = require('fs');
var deasync = require('deasync');
var uglify = require("uglify-js");
var busboy = require('connect-busboy');
var spawn = require('child_process').spawnSync;
var exec = require('child_process').exec;
var util = require('util');
var dirTree = require('directory-tree');

var moduleVars = require('./moduleVars');

var ISDEBUG = 0;    
var COMPILE_LIMIT = 10000; //max runtime in ms
var monitoring = false;
var WARNING_FAILURE_TO_RESOLVE_DATAFILE = 'The course or activity ID number could not be resolved. Please check your input and contact your professor if problems persist. ';
var WARNING_MALFORMED_DATAFILE = 'The course or activity ID data is corrupted or malformed. Please notify your professor for more details. ';
var WARNING_ACTIVITY_CLOSED = 'The course or activity has been closed. Please contact your professor for more information. ';
var WARNING_NOT_WHITELISTED = 'This exam is not available for you to access. Please contact your professor for more information. ';



//current dir: /includes/js

exports.getTree = function getTestsTree (dir, res) {
	var tree = dirTree(dir);
	// console.log(JSON.stringify(tree));

	tree = JSON.stringify(tree).replace(/\bname+/g, "text");

	//send object
	res.type('json');
	res.send( tree );
}


//Get/serve getModule interface to client
exports.requestQuizInfo = function getModuleSelector (req, res) {
	//min and serve js file
	var minifiedSelector = uglify.minify([__dirname + "/ModuleSelector.js"]);
	var scriptSelector = minifiedSelector.code; //all listeners and js code to be evald once client has received

	//send object
	res.type('json');
	res.send( {response_html : moduleVars.moduleSelector, response_script: scriptSelector} );
}


//Get specified datafile
exports.getDataFile = function getDataFile(req, res, callback)
{
	var file = './dataFiles/' + req.body.course_id.toUpperCase() + '/data' + req.body.test_id + '.json';

	fs.readFile(file, 'utf8', function (err, datafile) {
		if (err) {
			console.log('E: ' + err);
			res.type('json');
			res.send( {error: WARNING_FAILURE_TO_RESOLVE_DATAFILE + ((ISDEBUG) ? file : '')} );
			return;
		}

		var parsedJSON;
		try {
			parsedJSON = JSON.parse(datafile);
		}
		catch(err) {
			console.log('E: ' + err);
			res.type('json');
			res.send( {error: WARNING_MALFORMED_DATAFILE + ((ISDEBUG) ? file : '')} );
			return;
		}
		//after file is read, pass on request/response
		callback(req, res, parsedJSON);
	});
}

//Delete result file
exports.deleteFile = function deleteFile(req, res)
{
	var delStatus = false;
	var file = './' + req.body.path;
	fs.unlink(file, function(error) {
	    if (error) {
	        console.log('E: ' + error)
	    } else {
	    	delStatus = true;
	    }
    	res.type('json');
		res.send( {status: delStatus} );
	});
}

//Get specified result file
exports.getResultFile = function getResultFile(req, res, callback)
{
	var file = './' + req.body.path;

	fs.readFile(file, 'utf8', function (err, datafile) {
		if (err) {
			console.log('E: ' + err);
			res.type('json');
			res.send( {error: WARNING_FAILURE_TO_RESOLVE_DATAFILE + ((ISDEBUG) ? file : '')} );
			return;
		}

		//after file is read, pass on request/response vars along with parsed json data
		callback(req, res, datafile);
	});
}

//Serve pure json content for view/edit purposes
exports.serveFile = function serveFile(req, res, json) {
	res.type('json');
	res.send( {datafile : json} );
}


//This function pieces together the module js+html code sent back to the client using the data file + examlogic templates
exports.serveModule = function serveModule(req, res, data)
{
	//If closeDate/Time exists, enforce
	if(data["prop"]["closeDate"] && data["prop"]["closeDate"] != "" && data["prop"]["closeTime"] && data["prop"]["closeTime"] != "") {
		//Only serve if before specified end time
		var currDate = new Date();
		var specYear = parseInt(data["prop"]["closeDate"].split("-")[2]);
		var specMonth = parseInt(data["prop"]["closeDate"].split("-")[0]) - 1; //+
		var specDay = parseInt(data["prop"]["closeDate"].split("-")[1]);
		var specHour = parseInt(data["prop"]["closeTime"].split(":")[0]);
		var specMinute = parseInt(data["prop"]["closeTime"].split(":")[1]);
		var specDate = new Date(specYear, specMonth, specDay);
		specDate.setHours(specHour, specMinute, 0);

		if(currDate.getTime() > specDate.getTime()) {
			res.type('json');
			res.send( {error: WARNING_ACTIVITY_CLOSED} );
			return;
		}
		// console.log('spec: ', specDate.toString())
		// console.log('now: ', currDate.toString())
	}

	if(data["prop"]["access"]) {
		if(data["prop"]["access"] == "true") {
			if(data["prop"]["whitelist"]) {
				if(data["prop"]["whitelist"].indexOf(req.body.user_id) == -1) {
					res.type('json');
					res.send( {error: WARNING_NOT_WHITELISTED} );
					return;
				}
			}
		} else {
			res.type('json');
			res.send( {error: WARNING_ACTIVITY_CLOSED} );
			return;
		}
	}

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
	var mcSubQ = moduleVars.mcSubQ; // closes div tags that could not be closed until multiple iterations had been inserted.

	var genericCloseDiv = moduleVars.genericCloseDiv; // generic </div> for annoying case in mcOptions sub Qs

	var qToolsTemplate = moduleVars.qToolsTemplate; //function call to be appended per editor instance to init

	//script to be evald on client side
	var editorInit = moduleVars.editorInit; //function call to be appended per editor instance to init

	//minify js code to send to client to be evaluated
	var baseScript = fs.readFileSync(__dirname + '/examLogic.js', 'utf8'); //all listeners and js code to be eval'd once client has received
	var script = ""; //vars to be inserted into baseScript at runtime

	var html = ""; //html code to be inserted into dom client side

	//define difficulty levels - 0: easy, 1: medium, 2: hard
	var difficulty = [];

	//Decide which module to serve
	if(req.body.type == 'exam')
	{
		html = '<!--BEGIN module code-->' + requires + header;

		//iterate through each question in exam datafile, replacing placeholders with index and datafile specefied information
		for(var i = 0; i < Object.keys(data).length; i++)
		{
			//only look at keys 0-n, ignoring 'prop' key along with any possible malformed data
			if(!isNaN(Object.keys(data)[i]) && Object.keys(data)[i] == i)
			{
				//console.log(data)
				//record question difficulty
				difficulty.push(parseFloat(data[i]["difficulty"]));

				var lang = ""
				//Catch instances of c-like languages regardless of version. This is used to style the codemirror editor.
				if(data[i]["language"].toLowerCase() == "c" || data[i]["language"].indexOf("c++") != -1 || data[i]["language"].indexOf("c#") != -1)
					lang = "clike";
				else
					lang = "python";

				//if question type is a programming question (type: "code")
				if(data[i]["questionType"] == "code")
				{
					var skeletonCode = data[i]["skeleton"];
					if(data[i]["skeleton"].length == 3) {
						skeletonCode = data[i]["skeleton"][2];
					}

					//see ModuleVars.js file for templating documentation
					html += pStatementTemplate.replace(/<<n>>/g, i).replace(/<<pstatement>>/, data[i]["problem"]) + ioTemplate.replace(/<<n>>/g, i).replace(/<<code>>/, skeletonCode) + qToolsTemplate.replace(/<<n>>/, i);
					
					script += editorInit.replace(/<<n>>/g, i).replace(/<<lang>>/g, lang).replace(/<<rOnly>>/g, false);
				}
				//if question type is a programming question (type: "mchoice")
				else if(data[i]["questionType"] == "mchoice")
				{
					html += pStatementTemplate.replace(/<<n>>/g, i).replace(/<<pstatement>>/, data[i]["problem"]) + mcCodeTemplate.replace(/<<n>>/g, i).replace(/<<code>>/, data[i]["skeleton"]);
					script += editorInit.replace(/<<n>>/g, i).replace(/<<lang>>/g, lang).replace(/<<rOnly>>/g, true);

					//iterate through each multiple choice supplied in the datafile per question
					for(var j = 0; j < data[i]["input"].length; j++)
					{
						var tempSubQ = data[i]["input"][j][1];

						//Array of non-sorted options
						var tf = ["true", "false", "yes", "no", "legal", "illegal"];
						//Shuffle only non true/false MC
						if(tf.indexOf(tempSubQ[0].toLowerCase()) == -1)
						{
							//Shuffle subquestions via fisher-yates shuffle
							var counter = tempSubQ.length, temp, index;
							// While there are elements in the array
							while (counter > 0) {
								// Pick a random index
								index = Math.floor(Math.random() * counter);

								// Decrease counter by 1
								counter--;

								// And swap the last element with it
								temp = tempSubQ[counter];
								tempSubQ[counter] = tempSubQ[index];
								tempSubQ[index] = temp;
							}
						}

						html += mcSubQ.replace(/<<mcsq>>/g, data[i]["input"][j][0]);
						for(var k = 0; k < data[i]["input"][j][1].length; k++)
						{
							html += mcOptionTemplate.replace(/<<mc>>/g, tempSubQ[k]).replace(/<<o>>/g, k).replace(/<<n>>/g, i + "_" + j);
						}
						html += genericCloseDiv; //generic closing mcsubq
					}

					html += genericCloseDiv + qToolsTemplate.replace(/<<n>>/, i); //generic closing mcoptions
				}       
			}
		}

		//create variables to be inserted into script executed client side. 
		//vars defined: difficulty[per question], testInfo[test_id, course_id, test_length, warnTimes]
		var testInfoVars = "var difficulty = [" + difficulty.join() + "]; var testInfo = Object.freeze({user_id: '" + req.body.user_id + "', test_id: '" + req.body.test_id + "', course_id: '" + 
			req.body.course_id.toUpperCase() + "', test_length: '" + data["prop"]["time"]*60000 + "', warnTimes: '" + data["prop"]["warn"] +"'});";

		//insert navbar and end comment
		html += navTemplate + '<!--END module code-->';

		//commented out, due to codemirror add-on bug regarding dynamic loading
		//var completeScript = 'loadCmResources();' + testInfoVars + baseScript + script + 'refreshCmInstances();';
		var completeScript = testInfoVars + baseScript + script;
		
		//console.log('baseScript: \n', baseScript + '\n\n');
		//console.log('script: \n', script + '\n\n');
		//console.log('completeScript: \n', completeScript + '\n\n');

		//minify script
		var minified = uglify.minify(completeScript, {fromString: true});
		script = minified.code; //all listeners and js code to be evald once client has received
	}
	else if(req.body.type == 'book')
	{
		//Future work
	}

	
	//send object
	res.type('json');
	res.send( {response_html : html, response_script: script} );
}

//Grading function. 
//Requires linux environment to run correctly due to how compilation works (uses node spawn/exec and bash)
exports.processExam = function processExam(req, res, data)
{
	console.log("processing...");
	//Track points(subtotal = per question total, total = full total) and student score (subStudent = per question score, student score = total score)
	var totalPoints = 0;
	var subTotalPoints = 0;
	var studentScore = 0;
	var subStudentScore = 0;
	var resultFile = "";
	var prop = data.prop;
	var difficultyMultiplier = 10;
	var difficultyValue = 0;
	var allowMultiple = (data["prop"]["allowMultiple"]) ? JSON.parse(data["prop"]["allowMultiple"]) : false;
	//console.log(allowMultiple);

	//Remove properties field so it doesn't interfere with processing the answers (it would appear as though it were another question but with no data. Easier just to delete the property instead of coding around it)
	delete data.prop;

	//console.log("i-Loop start");
	for(var i = 0; i < Object.keys(data).length; i++)
	{
		//reset subtotal points, print next question label
		subTotalPoints = 0;
		subStudentScore = 0;
		//difficulty level * multiplier = n minutes (suggested question time), else default to 5min
		difficultyValue = (parseFloat(data[i]["difficulty"]) == 0) ? (difficultyMultiplier * .5) : ((parseFloat(data[i]["difficulty"])) * difficultyMultiplier);
		resultFile += "****** Question " + i + ", type: " + req.body.problemType[i] + " ******\n\n";


		if(req.body.problemType[i] == "code")
		{
			resultFile += "Submitted code:\n------------------------------------------\n\n" + req.body.solution[i] + "\n\n";

			//console.log("code j-Loop start");

			//Track points
			subTotalPoints += parseInt(data[i]["points"][0]);
			totalPoints += parseInt(data[i]["points"][0]);
			var testsfailed = false;
			//Loop through each 'output' aka test cases
			for(var j = 0; j < data[i]["output"].length; j++)
			{
				//User's data
				var userData = {
					"test_id": req.body.test_id,
					"course_id": req.body.course_id,
					"index": i,
					"code": req.body.solution[i], //user defined code
					"input": data[i]["input"][j], //datafile defined testcase
					"language": data[i]["language"].toLowerCase()
				};
				//console.log("compile start using: ", userData);
				//Global variables due to node requring async, and we need sync because we need to wait for the compilation result before returning our object. 
				var compileResult = undefined;
				new Promise(function(resolve, reject) {
					resolve(exports.compile(userData));
				}).then(function(data) {
						compileResult = data;
						//console.log("got compiled result:", compileResult);
					}).catch(function(err) {
						console.log("Error occurred during compilation: ", err);
					});

				while(compileResult === undefined) {
					require('deasync').sleep(500);
					//console.log("waiting...");
				}

				//console.log("compile finish");
				resultFile += "\n------------------------------------------\n\nTest Input: " + data[i]["input"][j] + "\n\nCorrect output: " + data[i]["output"][j] + "\n\nCompiled output: " + compileResult.Result + "\n\n";


				//console.log("comparing: [" + compileResult.Result.trim() + "]\n\nans: \n[", data[i]["output"][j].trim() + "]\n");

				//Check to see if compilation result is equal to the expected output defined in the datafile
				//trim and add newline as parsing the json adds a leading space, and compiling adds a trailing newline.
				if(data[i]["output"][j].trim() != compileResult.Result.trim())
				{
					testsfailed = true;
				}
			}

			//evaluate points
			if (!testsfailed)
			{
				subStudentScore += parseInt(data[i]["points"][0]);
				studentScore += parseInt(data[i]["points"][0]);
				resultFile += "Status: Correct\n\n";
			} else{
				resultFile += "Status: Incorrect\n\n";
			}

		} else if(req.body.problemType[i] == "mchoice")
		{
			//console.log("mchoice j-Loop start");
			for(var j = 0; j < data[i]["input"].length; j++)
			{
				//console.log('indexof: ', req.body.solution[i][j]);
				//console.log('submitted idx: ', data[i]["input"][j][1]);
				//console.log('sub solution: ', req.body.solution[i][j], ' | ', req.body.solution[i][j]);

				//Record input
				//Options are randomized, so to find correct index -> match on question first via indexOf
				var correctIndex = parseInt(data[i]["output"][j]);
				//var submittedIndex = parseInt(data[i]["input"][j][1].indexOf(convertSpecialChars(req.body.solution[i][j])));
				var submittedIndex = parseInt(data[i]["input"][j][1].indexOf(req.body.solution[i][j]));
				//console.log("[j:" + j + "] \ncorrectIndex: ", correctIndex, "\nsubmittedIndex", submittedIndex);
				resultFile += "Correct answer: " + data[i]["input"][j][1][correctIndex] + "\nReceived answer: " + data[i]["input"][j][1][submittedIndex] + "\n Status: ";

				//Track points
				subTotalPoints += parseInt(data[i]["points"][j]);
				totalPoints += parseInt(data[i]["points"][j]);

				if(correctIndex == submittedIndex)
				{
					subStudentScore += parseInt(data[i]["points"][j]);
					studentScore += parseInt(data[i]["points"][j]);
					resultFile += "Correct\n\n";
				} else {
					resultFile += "Incorrect\n\n";
				}
			}
		}

		resultFile += "Time remaining: " + req.body.timings[i] + "/" + difficultyValue + ":00";
		resultFile += "\nQuestion sub-score: " + subStudentScore + "/" + subTotalPoints + "\n====================================================\n\n\n\n";
	}
	resultFile += "\nTIME REMAINING: " + req.body.timings[req.body.timings.length - 1] + "/" + prop["time"] + ":00\n";
	resultFile += "FINAL SCORE: " + studentScore + "/" + totalPoints + "\n";

	//formulate paths, create directories if necessary. EEXIST e.code means dir already exists. If it doesn't, it will create.
	//We won't overwrite the coursepath or testpath to keep from losing data or student resubmissions. File creation timestamp can be used to verify timings if necessary
	var coursePath = './testResults/' + req.body.course_id.toUpperCase() + '/';
	var testPath = './testResults/' + req.body.course_id.toUpperCase() + '/test' + req.body.test_id + '/';
	
	//console.log("create class dir");
	try {
		fs.mkdirSync(coursePath);
	} catch(e) {
		if ( e.code != 'EEXIST' ) 
		throw e;
	}

	//console.log("create test dir");
	try {
		fs.mkdirSync(testPath);
	} catch(e) {
		if ( e.code != 'EEXIST' ) 
		throw e;
	}


	//console.log("write result file");
	if(allowMultiple) {
		var d = new Date();
		var monthVal = d.getMonth() + 1;
		var writeDateTime = monthVal + '-' + d.getDate() + ' ' + d.toLocaleTimeString();

		fs.writeFile(testPath + req.body.idNum + ' [' +  writeDateTime + '].txt', resultFile, function(err) {
			if(err) {
				console.log(err);
				res.type('json');  
				res.send({status : "Error", score: studentScore + "/" + totalPoints + ", file could not be saved, please see instructor."});
				return;
			}
		});
	} else {
		if (!fs.existsSync(testPath + req.body.idNum + '.txt')) { //if not exists, write
			fs.writeFile(testPath + req.body.idNum + '.txt', resultFile, function(err) {
				if(err) {
					console.log(err);
					res.type('json');  
					res.send({status : "Error", score: studentScore + "/" + totalPoints + ", NOTE: file could not be saved, please do not leave this page and see instructor."});
					return;
				}
			});
		} else { //if exists, dont write
			res.type('json');  
			res.send({status : "ok", score: studentScore + "/" + totalPoints + ", NOTE: For this exam, only one attempt can be recorded per user. These results will not be saved."});
			return;
		}
	}

	res.type('json');  
	res.send({status : "ok", score: studentScore + "/" + totalPoints});
}

// Note: Replaces < and > characters as using something such as <iostream> differs when parsed as html vs json.
function convertSpecialChars(string) {
	return string.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


//This function needs to be modified when adding support for more languages
//Compiles and or executes code
//data: [code, input, language]
//res: response object, exists only if called from /compile endpoint
//type: exists only if called from /compile endpoint, if so specifies type as 'post'
exports.compile = function compile(data, res, type){
	//Before beginning a new program, check for escaped processes
	findKillLongRunningProcs();

	//NOTE: UPDATE THIS IF IN NEW ENVIRONMENT
	var regHomePathPattern = new RegExp("(cs-eval-fw)","g");
	var fullP = process.env.rootPath.replace('/', '\\/');
	var regFullPathPattern = new RegExp("("+fullP+")","g");
	var response = {
		Errors: '',
		Result: ''
	}
	var submittedCode = '';

	//TODO: cron-esque to wipe folder every once in awhile
	//Generate tmp string using timestamp and ints 0-9999 for directory name
	var tmpDir = '' + Date.now() + Math.floor(Math.random() * (9999 - 0) + 0);
	var fileBasePath = process.env.rootPath + '/compilation/' + tmpDir + '/';
	try {
		fs.mkdirSync('./compilation/' + tmpDir);
	} catch(e) {
		if ( e.code != 'EEXIST' ) 
			throw e;
	}

	return new Promise(function (resolve, reject) {
		//If hidden skeleton, fetch and merge with user code for compilation. We are assuming a well-formed JSON as it
		//was already validated earlier when loading the test
		var tmpDataFilePath = './dataFiles/' + data.course_id.toUpperCase() + '/data' + data.test_id + '.json';
		var dfile = fs.readFileSync(tmpDataFilePath, 'utf8');
		parsedJSON = JSON.parse(dfile);
		if (parsedJSON[data.index]["skeleton"].length == 3) {
			var hidSkel = parsedJSON[data.index]["skeleton"][0];
			var hidToken = parsedJSON[data.index]["skeleton"][1];
			resolve(hidSkel.split(hidToken).join(data.code));
		} else {
			resolve(data.code);
		}
	}).then(function(submittedCode) {
		//if c++, use gcc
		if(data.language.toLowerCase().indexOf('c++') != -1) {
			//Write code to file
			fs.writeFileSync('./compilation/' + tmpDir + "/code.cpp", submittedCode, 'utf-8', function(err) {
				if(err) {
					return console.log(err);
				}
			});

			//compile code
			var compileChild;
			var execChild;
			if(data.language.toLowerCase().indexOf('c++14') != -1) {
				compileChild = spawn('g++-5 -std=c++14', [fileBasePath + "code.cpp", "-o", fileBasePath + "compOutput"], {
					shell: true
				});
			} else{
				compileChild = spawn('g++-5 -std=c++11', [fileBasePath + "code.cpp", "-o", fileBasePath + "compOutput"], {
					shell: true
				});
			}

			//console.log('[COMPILE]\nout: ', String(compileChild.stdout), '\nerr: ', String(compileChild.stderr));

			//If there are errors - report, else run code if there were no compilation errors
			if(String(compileChild.stderr) != ''){
				response.Errors += String(compileChild.stderr) + '\n';
				if(type == "post") {
					response.Errors = response.Errors.replace(regFullPathPattern, "FULL_WORKING_PATH").replace(regHomePathPattern, "WORKING_PATH");
				}
				return response;
			} else {
				//if no input. There will always be at least a newline, so empty string with \n is empty input
				if(data.input == '\n') {
					try{
					return new Promise(function (resolve, reject) {
						execChild = exec(fileBasePath + 'compOutput', {timeout: COMPILE_LIMIT},
							(error, stdout, stderr) => {
								if(error !== null){
									//response.Errors += error + "\n";
									console.log(`Runtime error: ${error}`);
								}
								response.Errors += stderr;
								response.Result += stdout;
									
								if(type == "post") {
									//console.log("sending response: ", stdout);
									response.Errors = response.Errors.replace(regFullPathPattern, "FULL_WORKING_PATH").replace(regHomePathPattern, "WORKING_PATH");
								}
								resolve(response);
							});
					}).then(function(err) {
						return response;
					})

					} catch(e){
						//console.log(util.inspect(e, {showHidden: false, depth: null}));
						var err = String(e);
						response.Errors += err;
						return response;
					}

				} else {
					//Can't get it to feed in multiple inputs unless from a file with CRLFs
					fs.writeFileSync('./compilation/' + tmpDir + "/input.txt", data.input, 'utf-8', function(err) {
						if(err) {
							return console.log(err);
						}
					});

					//cat inputs and pipe into compOutput.o executable  
					try{
					return new Promise(function (resolve, reject) {
						execChild = exec('cat ' + fileBasePath + 'input.txt | ' + fileBasePath + 'compOutput', { timeout: COMPILE_LIMIT, killSignal: 'SIGKILL'}, 
							(error, stdout, stderr) => {
								if(error !== null){
									//response.Errors += error + "\n";
									console.log(`Runtime error: ${error}`);
								}
								response.Errors += stderr;
								response.Result += stdout;
									
								if(type == "post") {
									//console.log("sending response: ", stdout);
									response.Errors = response.Errors.replace(regFullPathPattern, "FULL_WORKING_PATH").replace(regHomePathPattern, "WORKING_PATH");
								}
								resolve(response);
						});
					}).then(function(err) {
						return response;
					});

					} catch(e){
						//console.log(util.inspect(e, {showHidden: false, depth: null}));
						var err = String(e);
						response.Errors += err;
						return response;
					}
				}

				//console.log('\n[RUN]: ', response);
			}

			//if python (only supporting python 3.X)
		} else if(data.language.toLowerCase().indexOf("python") != -1) {
			//console.log("python");
			//Write code to file
			fs.writeFileSync('./compilation/' + tmpDir + "/code.py", submittedCode, 'utf-8', function(err) {
				if(err) {
					return console.log(err);
				}
			});

			//if no input. There will always be at least a newline, so empty string with \n is empty input
			var execChild;
			if(data.input == '\n') {
				try{
					return new Promise(function (resolve, reject) {
						execChild = exec("python3 " + fileBasePath + 'code.py', { timeout: COMPILE_LIMIT, killSignal: 'SIGKILL'}, 
						(error, stdout, stderr) => {
							if(error !== null){
								//response.Errors += error + "\n";
								console.log(`Runtime error: ${error}`);
							}
							response.Errors += stderr;
							response.Result += stdout;
								
							if(type == "post") {
								//console.log("sending response: ", stdout);
								response.Errors = response.Errors.replace(regFullPathPattern, "FULL_WORKING_PATH").replace(regHomePathPattern, "WORKING_PATH");
							}
							resolve(response);
						});
					}).then(function(err) {
						return response;
					});
				} catch(e){
					//console.log(util.inspect(e, {showHidden: false, depth: null}));
					var err = String(e);
					var errIdx = err.indexOf("code.py\",");
					if(errIdx < 0 || errIdx > err.length)
						errIdx = 0;
					response.Errors += err.substring(errIdx + 10, err.length);
					return response;
				}

			} else {
				//Won't feed in multiple inputs unless from a file with CRLFs
				//So write inputs to file first
				fs.writeFileSync('./compilation/' + tmpDir + "/input.txt", data.input, 'utf-8', function(err) {
					if(err) {
						return console.log(err);
					}
				});

				//cat inputs and then pipe into py script
				try{
					return new Promise(function (resolve, reject) {
						execChild = exec('cat ' + fileBasePath + 'input.txt | python3 ' + fileBasePath + 'code.py', { timeout: COMPILE_LIMIT, killSignal: 'SIGKILL'}, 
							(error, stdout, stderr) => {
								if(error !== null){
									//response.Errors += error + "\n";
									console.log(`Runtime error: ${error}`);
								}
								response.Errors += stderr;
								response.Result += stdout;
									
								if(type == "post") {
									//console.log("sending response: ", stdout);
									response.Errors = response.Errors.replace(regFullPathPattern, "FULL_WORKING_PATH").replace(regHomePathPattern, "WORKING_PATH");
								}
								resolve(response);
							});
					}).then(function(err) {
						return response
					});
				} catch(e){
				console.log(util.inspect(e, {showHidden: false, depth: null}));
					var err = String(e);
					var errIdx = err.indexOf("code.py\",");
					if(errIdx < 0 || errIdx > err.length)
						errIdx = 0;
					response.Errors += err.substring(errIdx + 10, err.length);
					return response;
				}
			}

			//console.log('\n[RUN]: ', response);
		} else {

			console.log('Unkown language, cannot compile!');
			console.log('Data: ', data);

			response.Result += "Unkown language, cannot compile!";

			if(type == "post") {
				response.Errors = response.Errors.replace(regFullPathPattern, "FULL_WORKING_PATH").replace(regHomePathPattern, "WORKING_PATH");
			}
			return response;
		}
	});
}

//Stores datafiles created from the admin page
exports.storeDatafile = function storeDatafile(type, req, res) {
	res.type('json');

	//if uploaded well-formed json file
	if(type == 'file') {
		//Write file
		var fstream,
			filePath,
			fullFilePath,
			fileDetails,
			fname;

		req.busboy.on('file', function (fieldname, file, filename) {
			fileDetails = fieldname.split('===');
			fname = 'data' + fileDetails[1];
			filePath =  './dataFiles/' + fileDetails[0].toUpperCase();
			fullFilePath =  './dataFiles/' + fileDetails[0].toUpperCase() + '/' + fname + '.json';

			//filepath: ./dataFiles/courseid/specifiedname.json

			try {
				fs.mkdirSync(filePath);
			} catch(e) {
				if ( e.code != 'EEXIST' ) 
					throw e;
			}

			fstream = fs.createWriteStream(fullFilePath);
			file.pipe(fstream);

			res.send({success : true});
		});

	//else uploaded json data via text
	} else {
		var parsedJSON;
		try {
			parsedJSON = JSON.parse(req.body.code);
		}
		catch(err) {
			console.log('E: ' + err);
			res.type('json');
			res.send( {error: 'The data submitted was malformed. Please validate JSON before reattempting.'} );
			return;
		}

		var filePath = './dataFiles/' + req.body.course_id.toUpperCase();
		var fullFilePath = filePath + '/data' + req.body.act_id + '.json';

		//create directory if needed
		try {
			fs.mkdirSync(filePath);
		} catch(e) {
			if ( e.code != 'EEXIST' ) 
				throw e;
		}

		try {
			//write file
			fs.writeFileSync(fullFilePath, parsedJSON , 'utf-8'); 
		} catch(e) {
			if ( e.code != 'EEXIST' ) {
				fs.unlinkSync(fullFilePath);
				fs.writeFileSync(fullFilePath, parsedJSON , 'utf-8'); 
			}
		}
		
		res.send({success : true});
	}
}


exports.downloadReport = function (req, res) {
	var dirPath = req.body.path; //root/course/exam (ex: testResults/CPTR999/test0) './' + 
	var filePath;
	var htmlContent = "<div id='reportContainer'>";
	fs.readdirSync(dirPath).forEach(file => {
		//console.log('file: ', file);
		filePath = dirPath + '/' + file;
		fileContent = fs.readFileSync(filePath, 'utf8');

		//Insert html markup
		htmlContent += "<div>";
		htmlContent += "<h2>Student ID: " + file.replace(".txt", "") + "</h2>";
		fileContent = fileContent.replace(/\r|\n/g, "<br />");
		fileContent = fileContent.replace(/ Correct/g, " <span style='background-color:#68c977'>Correct</span>");
		fileContent = fileContent.replace(/ Incorrect/g, " <span style='background-color:#ff6666'>Incorrect</span>");
		fileContent = fileContent.replace(/====================================================/g, "<strong>====================================================</strong>");
		fileContent = fileContent.replace(/Question sub-score:/g, "<span style='background-color:#efeea5'>Question sub-score:</span>");
		fileContent = fileContent.replace(/FINAL SCORE:/g, "<span style='background-color:#edeb82; font-weight:bold;'>FINAL SCORE:</span>");
		fileContent = fileContent.replace(/TIME REMAINING:/g, "<span style='background-color:#edeb82; font-weight:bold;'>TIME REMAINING:</span>");

		htmlContent += fileContent + "</div><hr><br />";
	});
	htmlContent += "</div>";

	res.type('json');  
	res.send({report: htmlContent});
}


function findKillLongRunningProcs(continueMonitoring){
	/*ps -ef | grep /compOutput | grep -v grep | awk '{print " "$2" " $7}'
	* Returns PID runtime:
	* 24241 00:18:52
	* 24257 00:06:26
	*/
	//console.log('start monitor')
	try{
		execChild = exec('ps -ef | grep /compOutput | grep -v grep | awk \'{print " "$2" " $7}\'',
			(error, stdout, stderr) => {
				if(error !== null){
					console.log(`Error attempting to monitor long running procs: ${error}`);
				}
				//console.log('entries: ', stdout.split('\n')); // -> entries:  mult: [ ' 25200 00:00:27', ' 25208 00:00:25', '' ], single: [' 25742 00:00:00'], none: ['']
				var entries = stdout.split('\n');
				if(entries[0] != '') {
					var pid;
					var seconds;
					for(var i = 0; i < entries.length; i++){
						if(entries[i].trim() != '') { //if valid entry
							pid = entries[i].trim().split(' ')[0];
							seconds = entries[i].trim().split(' ')[1].split(':')[2]; //Only need to look at seconds as anything above compile limit (in seconds) will be killed

							if(seconds.valueOf() > ((COMPILE_LIMIT / 1000) % 60)) { // if greater than compile limit (converted from ms to s)
								console.log('found long running proc, PID: ', pid, 'runtime: ', seconds, '. Killing...');
								exec('kill -9 ' + pid);
							}
						}
					}
				}
			}
		);
	} catch(e){
		console.log(util.inspect(e, {showHidden: false, depth: null}));
	}
}
