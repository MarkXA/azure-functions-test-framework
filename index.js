"use strict";

const util = require("util");
const fs = require("fs");
const moment = require("moment");

const hostName = process.env["WEBSITE_HOSTNAME"] || process.env["COMPUTERNAME"] || "azurefunctions";

module.exports = {
	httpBinding(args) {
		const result = Object.assign({
			method: "GET",
			query: {},
			headers: {}
		}, args);

		if (result.body && !result.rawBody) {
			result.rawBody = JSON.stringify(result.body);
		} else if (result.rawBody && result.body) {
			try {
				result.body = JSON.parse(result.rawBody);
			} catch (exc) { }
		}

		return result;
	},

	timerBinding(args) {
		const result = Object.assign({
			"isPastDue": false,
			"last": moment().subtract(1, "minutes").toISOString(),
			"next": moment().add(1, "minutes").toISOString()
		}, args);

		return result;
	},

	runTests(tests) {
		const appSettings = JSON.parse(fs.readFileSync("./appsettings.json", "utf8"));
		for (let key in appSettings)
			process.env["APPSETTING_" + key] = appSettings[key];

		var testResults = [];
		for (let testName in tests)
			testResults.push(this.runTest(Object.assign({ testName: testName }, tests[testName])));
		Promise.all(testResults).then(results => {
			const success = results.reduce((val, cur) => val && cur, true);
			if (success)
				console.log("All tests passed");
			else
				console.error("Some tests failed");
		}).catch(() => {
			console.error("Some tests failed");
		});
	},

	runTest(args) {
		return new Promise((resolve, reject) => {
			const functionName = args.functionName;
			const testName = args.testName || functionName;
			const inBinding = args.binding;
			const assertions = args.assertions;

			const fnDef = JSON.parse(fs.readFileSync(`./${functionName}/function.json`, "utf8"));
			const invar = fnDef.bindings.find(b => b.direction === "in").name;
			const outBinding = fnDef.bindings.find(b => b.direction === "out");
			const outvar = outBinding && outBinding.name;

			const context = {
				log() {
					if (typeof (arguments[0]) === "string")
						console.log(util.format.apply(null, arguments));
					else
						console.dir(arguments[0]);
				},
				done(err, output) {
					if (err)
						console.info(`${testName}: Failure returned - ${util.inspect(err)}`);
					else
						console.info(`${testName}: Success returned`);
					try {
						assertions && assertions(err, output || this[outvar]);
						resolve(true);
					} catch (exc) {
						console.error(`${testName}: ${util.inspect(exc)}`);
						resolve(false);
					}
				}
			};

			const query = inBinding.query;
			if (query) {
				const keys = Object.keys(query);
				const querystring = keys.length > 0 ? "?" + keys.map(k => encodeURIComponent(k) + "=" + encodeURIComponent(query[k])).join("&") : "";
				inBinding.originalUrl = `https://${hostName}/api/${functionName}${querystring}`;
			}

			const fn = require(`../${functionName}/index.js`);
			fn(context, inBinding);
		});
	}
};