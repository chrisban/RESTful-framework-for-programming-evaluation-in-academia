exports.getSettings = function getSettings(lang){
	var options = {
		args: '',
		wrapper: ''
	};

	if(lang == 'python3' || lang == 'python') //python will default to python 3
	{
		options.args = '';
		options.wrapper = '24';	
	} else if(lang == "c++14" || lang == 'c++') //c++ will default to c++14
	{
		options.args = '-std=c++14 -o a.out source_file.cpp';
		options.wrapper = "7";
	}

	return options;
}
