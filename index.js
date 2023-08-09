require('dotenv').config({path:'almatools-tasks.env'})
const fs = require('fs');
const cron = require('node-cron');
const https = require('https');
const axios = require('axios')
var crypto = require('crypto');
const path = require('path');
const nodemailer = require('nodemailer');
const hbs = require('nodemailer-express-handlebars')
const ftp = require('basic-ftp');
const archiver = require('archiver');
var parseString = require('xml2js').parseString;

var appath = "./";

const database = require('./db');

var primoxserviceendpoint = process.env.PRIMO_XSERVICE_ENDPOINT;


async function runAlma(jobpath, payload) {

    try {  
        almapiurl = process.env.ALMA_API_ENDPOINT + jobpath + '?op=run&apikey=' + process.env.ALMA_APIKEY
        const almaresponse = await axios.post(almapiurl, payload )
        console.log(almaresponse.data);
    } catch(err) {
        console.log(err.message)
    }
       
}

async function sendMail(mail_to, lang) {
    const handlebarOptions = {
        viewEngine: {
            partialsDir: path.resolve('./templates/'),
            defaultLayout: false,
        },
        viewPath: path.resolve('./templates/'),
    };

    const transporter = nodemailer.createTransport({
        port: 25,
        host: process.env.SMTP_HOST,
        tls: {
            rejectUnauthorized: false
        }
        //requireTLS: true
        //secure: true
    });

    transporter.use('compile', hbs(handlebarOptions))

    let mailoptions = {}
    let template = 'email_sv'
    let subject = process.env.MAILFROM_SUBJECT_SV
    if (lang.toUpperCase() == "EN") {
        template = 'email_en'
        subject = process.env.MAILFROM_SUBJECT_EN
    }

    mailoptions = {
        from: {
            address: process.env.MAILFROM_ADDRESS
        },
        to: mail_to,
        subject: subject,
        template: template,
        context:{
        },
        generateTextFromHTML: true
    };

    try {
        let send_mail = await transporter.sendMail(mailoptions);
        return true
    } catch (err) {
        console.log(err.response)
        return false
    }
}

//Hämta senaste aktiveringsdatum från tabellen newbooks
const getLatestActivationDate = (con) => {
    return new Promise(function (resolve, reject) {
        const sql = `SELECT DATE_FORMAT(max(activationdate), "%Y-%m-%d") as latestactivationdate 
		FROM newbooks 
		LIMIT 1`;
        con.query(sql,(err, result) => {
            if(err) {
                console.error(err);
                reject(err.message)
            }
            resolve(result[0].latestactivationdate);
        });
    })
};

const deleteBooks = (booktype, con) => {
    return new Promise(function (resolve, reject) {
		var currentdate = new Date();
        const sql = `DELETE FROM newbooks WHERE booktype = '${booktype}'`;
        con.query(sql,(err, result) => {
            if(err) {
                con.rollback(function() {
					fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest, error deleting \n", function (err) {
						if (err) throw err;
					});
				});
                reject(err.message)
            }
			fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest, Books deleted \n", function (err) {
				if (err) throw err;
			});
			console.log("Books deleted");
            resolve(result);
        });
    })
};

async function addgooglecover(records, index, booktype, con, google_tries) {
    let sql
	var thumbnail = "";
	thumbnail =	records[index].thumbnail;
	var coverURL = "";
	if(thumbnail && ! index > records.length) {
		axios.get(thumbnail)
			.then(async googleres => {
				try {
					google_tries = 0;
					var googleresponse = googleres.data.replace("updateGBSCover(","");
					googleresponse = googleresponse.replace(");","");
					googleresponse = JSON.parse(googleresponse);
					for (var key in googleresponse) {
						if (typeof googleresponse[key].thumbnail_url != 'undefined'){
							coverURL = googleresponse[key].thumbnail_url.replace("proxy-eu.hosted.exlibrisgroup.com/exl_rewrite/","");
							sql = "UPDATE newbooks SET coverurl = '" + coverURL + "'" + 
								" WHERE id = '" + records[index].id + "'";
							con.query(sql)
						}
					}
					if(coverURL == "") {
						//syndetics som backup om inte google har omslaget
						coverURL = 'https://secure.syndetics.com/index.aspx?isbn=' + records[index].isbnprimo + '/lc.gif&client=primo&type=unbound&imagelinking=1';
						const img = await axios.get(coverURL)
						if(img.headers['content-length']=='6210') {
							coverURL = process.env.DEFAULT_COVER_URL
						}
						if( records[index].isbnprimo == '') {
							coverURL = process.env.DEFAULT_COVER_URL
						}

						sql = "UPDATE newbooks SET coverurl = '" + coverURL + "'" + 
								" WHERE id = '" + records[index].id + "'";
						con.query(sql)
					}
					index++;
					if (index < records.length){
						//modulo
						if( index % 50 == 0 ){
							currentdate = new Date();
							fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + "Harvest, googlecover index: " + index + "...\n", function (err) {
								if (err) throw err;
							});
							console.log("index: " + index + "...");
						}
						addgooglecover(records,index, booktype, con);
					} else {
						currentdate = new Date();
						fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + "Harvest, addgooglecover finished \n", function (err) {
							if (err) throw err;
						});
						console.log("addgooglecover finished");
						//Avsluta transaktion när hela processen är klar.
						con.commit(function(error) {
							if (error) { 
								con.rollback(function() {
								});
							}
							currentdate = new Date();
							fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + "Harvest, Database Transaction Complete \n", function (err) {
								if (err) throw err;
							});
							fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest, Finished! \n", function (err) {
								if (err) throw err;
							});
							console.log('Transaction Complete.');
						});
					}
				} catch(err) {
					console.log("Error when adding covers")
					console.log(err)
				}
			})
			.catch(async error => {
				console.log("GoogleError: " + error);
				if (google_tries < 5) {
					google_tries++;
					addgooglecover(records, index, booktype, con, google_tries);
				} else {
					//syndetics som backup om inte google har omslaget
					coverURL = 'https://secure.syndetics.com/index.aspx?isbn=' + records[index].isbnprimo + '/lc.gif&client=primo&type=unbound&imagelinking=1';
					const img = await axios.get(coverURL)
					if(img.headers['content-length']=='6210') {
						coverURL = process.env.DEFAULT_COVER_URL
					}
					if( records[index].isbnprimo == '') {
						coverURL = process.env.DEFAULT_COVER_URL
					}

					sql = "UPDATE newbooks SET coverurl = '" + coverURL + "'" + 
							" WHERE id = '" + records[index].id + "'";
					con.query(sql)
					index++;
					addgooglecover(records, index, booktype, con, google_tries);
				}
			});
	} else {
		//syndetics som backup om inte google har omslaget
		coverURL = 'https://secure.syndetics.com/index.aspx?isbn=' + records[index].isbn + '/lc.gif&client=primo&type=unbound&imagelinking=1';
		const img = await axios.get(coverURL)
		if(img.headers['content-length']=='6210') {
			coverURL = process.env.DEFAULT_COVER_URL
		}
		if( records[index].isbnprimo == '') {
			coverURL = process.env.DEFAULT_COVER_URL
		}

		sql = "UPDATE newbooks SET coverurl = '" + coverURL + "'" + 
				" WHERE id = '" + records[index].id + "'";
		con.query(sql)
		index++;
		addgooglecover(records,index, booktype, con);
	}
}

function callprimoxservice(records,index, booktype, con) {
	var endpoint = primoxserviceendpoint + '?json=true&institution=46KTH&onCampus=true&query=addsrcrid,exact,' + records[index].mmsid + '&indx=1&bulkSize=10&loc=local,scope:(46KTH)&loc=adaptor,primo_central_multiple_fe';	
	axios.get(endpoint)
		.then(response => {
			try {
				if(typeof response.data.SEGMENTS.JAGROOT.RESULT.DOCSET.DOC !== 'undefined') {
					var isbnprimo = "";
					if(typeof response.data.SEGMENTS.JAGROOT.RESULT.DOCSET.DOC.PrimoNMBib.record.search.isbn !== 'undefined') {
						if(booktype == "E") {
							isbnprimo = response.data.SEGMENTS.JAGROOT.RESULT.DOCSET.DOC.PrimoNMBib.record.search.isbn[0];
						} else {
							isbnprimo = records[index].isbn
						}
					}
					var thumbnail = "";
					if(typeof response.data.SEGMENTS.JAGROOT.RESULT.DOCSET.DOC.LINKS.thumbnail !== 'undefined') {
						thumbnail = response.data.SEGMENTS.JAGROOT.RESULT.DOCSET.DOC.LINKS.thumbnail[1];
					}
					sql = "UPDATE newbooks SET recordid = '" + response.data.SEGMENTS.JAGROOT.RESULT.DOCSET.DOC.PrimoNMBib.record.control.recordid + 
						"' ,isbnprimo = '" + isbnprimo + 
						"' ,thumbnail = '" + thumbnail + 
						"' WHERE mmsid = '" + records[index].mmsid + "'";
					con.query(sql)
				} else {
					fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + "recordid saknas, mmsid: " + records[index].mmsid + "...\n", function (err) {
						if (err) throw err;
					});
					console.log("recordid saknas, mmsid: " + records[index].mmsid);
					console.log(JSON.stringify(response.data, null, 2));
					console.log(endpoint);
				}
				index++;
				if (index < records.length){
					//modulo
					if( index % 50 == 0 ){
						currentdate = new Date();
						fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + "Harvest, primoupdate index: " + index + "...\n", function (err) {
							if (err) throw err;
						});
						console.log("index: " + index + "...");
					}
					callprimoxservice(records,index, booktype, con);
				} else {
					currentdate = new Date();
					fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest, primox finished \n", function (err) {
						if (err) throw err;
					});
					console.log("primox finished");
					con.query("SELECT * FROM newbooks where booktype = '" + booktype + "' AND thumbnail != '' AND thumbnail != 'no_cover' and thumbnail != 'o'", function (error, result, fields) {
						if (error) {
							currentdate = new Date();
							fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest, error selecting " + error + "\n", function (err) {
								if (err) throw err;
							});
						} else {
							console.log(result.length)
							addgooglecover(result, 0, booktype, con);
						}
					});
				}
			} catch(err) {
				console.log("Error calling primoxservice")
				console.log(err)
			}
		})
		.catch(error => {
			console.log("Error, callprimoxservice: " + error + " mmsid: " + records[index].mmsid);
		});
}

function callalmaanalytics_E(endpoint, latestactivationdate, token, nrofprocessedrecords, con){
	var IsFinished = 'false';
	var booksarray = [];
	var mmsid;
	var isbn;
	var title;
	var activationdate;
	var dewey;
	var subject;
	var category;
	var subcategory;
    let publicationdate

	var endpoint
	endpoint = process.env.ALMA_ANALYTICS_API_ENDPOINT_EBOOKS + 
	`&filter=<sawx:expr xsi:type="sawx:comparison" op="greaterOrEqual" xmlns:saw="com.siebel.analytics.web/report/v1.1" xmlns:sawx="com.siebel.analytics.web/expression/v1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><sawx:expr xsi:type="sawx:sqlExpression">"E-Inventory"."Portfolio Activation Date"."Portfolio Activation Date"</sawx:expr><sawx:expr xsi:type="sawx:sqlExpression">TIMESTAMPADD(SQL_TSI_DAY, +1, date '${latestactivationdate}')</sawx:expr></sawx:expr>&limit=25`;

	if(token!= '') {
		endpoint = endpoint + '&token=' + token;
	}
	https.get(endpoint, (resp) => {
		let data = '';

		resp.on('data', (chunk) => {
				data += chunk;
		});

		resp.on('end', () => {
				parseString(data, function (err, result) {
					try {
						if (typeof result.report.QueryResult !== 'undefined') {
							mmsid = '';
							isbn = '';
							title = '';
							activationdate = '';
							dewey = '';
							subject = '';
							category = '';
							subcategory = '';
							publicationdate = '';
							IsFinished = result.report.QueryResult[0].IsFinished[0];
							if(typeof result.report.QueryResult[0].ResumptionToken !== 'undefined') {
								token = result.report.QueryResult[0].ResumptionToken[0];
							}
							if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row !== 'undefined') {
								for (index in result.report.QueryResult[0].ResultXml[0].rowset[0].Row) {
									if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column5 !== 'undefined') {
										mmsid = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column5[0];
									}
									if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column4 !== 'undefined') {
										isbn = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column4[0].split(';')[0];
									}
									if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column6 !== 'undefined') {
										title = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column6[0];
									}
									if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column10!== 'undefined') {
										activationdate = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column10[0];
									}
									if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column11!== 'undefined') {
										publicationdate = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column11[0];
									}
									if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column3 !== 'undefined') {
										dewey = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column3[0];
									}
									if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column7 !== 'undefined') {
										if (result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column7 !== 'Unknown') {
											subject = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column7[0];
										}
									}
									if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column8 !== 'undefined') {
										if (result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column8 !== 'Unknown') {
											category = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column8[0];
										}
									}
									if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column9 !== 'undefined') {
										if (result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column9 !== 'Unknown') {
											subcategory = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column9[0];
										}
									}
									//samla alla inserts i array och gör bara ett anrop efter iterationen är färdig.
									booksarray.push([mmsid, '', isbn, title, activationdate, publicationdate, dewey, subject, category, subcategory,'E']);
								}
								sql = "INSERT INTO newbooks(mmsid, recordid, isbn, title, activationdate, publicationdate, dewey, subject, category, subcategory, booktype) VALUES ?";
								con.query(sql, [booksarray]);
								currentdate = new Date();
								fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest, Inserted " + booksarray.length + " rows \n", function (err) {
									if (err) throw err;
								});
								console.log("inserted " + booksarray.length + " rows");
								nrofprocessedrecords = nrofprocessedrecords + booksarray.length;
								console.log("nrofprocessedrecords " + nrofprocessedrecords);
								//max xxx titlar
								if(IsFinished == 'false' && nrofprocessedrecords < 10000) {
									callalmaanalytics_E(endpoint, latestactivationdate, token,nrofprocessedrecords, con);
								} else {
									//Alla titlar hämtade och tillagda i tabellen newbooks
									sql = `SELECT * FROM newbooks 
											WHERE booktype = 'E'
											AND activationdate > '${latestactivationdate}'
											ORDER BY activationdate DESC 
											LIMIT 500`
									con.query(sql, function (error, result, fields) {
										if (error) {
											currentdate = new Date();
											fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest, Error selecting " + error + "\n", function (err) {
												if (err) throw err;
											});
										} else {
											callprimoxservice(result, 0, 'E', con);
										}
									});
								}
							} else {
								currentdate = new Date();
								fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest, No new books to harvest! \n", function (err) {
									if (err) throw err;
								});
								fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest, Finished! \n", function (err) {
									if (err) throw err;
								});
								console.log("No new books to harvest!");
								con.rollback(function() {
								});
							}

						}
					} catch(err) {
						console.log("Error calling alma analytics E")
						console.log(err)
					}
				});
		});
	}).on("error", (err) => {
		console.log("Error: " + err.message);
	});
}

function callalmaanalytics_P(endpoint, latestactivationdate, token, nrofprocessedrecords, con){
	var IsFinished = 'false';
	var booksarray = [];
	var mmsid;
	var isbn;
	var title;
	var activationdate;
	var dewey;
	var subject;
	var category;
	var subcategory;

	var endpoint
	endpoint = process.env.ALMA_ANALYTICS_API_ENDPOINT_PBOOKS + 
	`&filter=<sawx:expr xsi:type="sawx:comparison" op="greaterOrEqual" xmlns:saw="com.siebel.analytics.web/report/v1.1" xmlns:sawx="com.siebel.analytics.web/expression/v1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><sawx:expr xsi:type="sawx:sqlExpression">"Physical Item Details"."Receiving Date (Calendar)"</sawx:expr><sawx:expr xsi:type="sawx:sqlExpression">TIMESTAMPADD(SQL_TSI_DAY, +1, date '${latestactivationdate}')</sawx:expr></sawx:expr>&limit=25`;

	if(token!= '') {
		endpoint = endpoint + '&token=' + token;
	}
    	https.get(endpoint, (resp) => {
    	let data = '';

	resp.on('data', (chunk) => {
        	data += chunk;
	});

	resp.on('end', () => {
        	parseString(data, function (err, result) {
				try {
					if (typeof result.report.QueryResult !== 'undefined') {
						mmsid = '';
						isbn = '';
						title = '';
						activationdate = '';
						dewey = '';
						subject = '';
						category = '';
						subcategory = '';
						publicationdate = '';
						IsFinished = result.report.QueryResult[0].IsFinished[0];
						if(typeof result.report.QueryResult[0].ResumptionToken !== 'undefined') {
							token = result.report.QueryResult[0].ResumptionToken[0];
						}
						if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row !== 'undefined') {
							for (index in result.report.QueryResult[0].ResultXml[0].rowset[0].Row) {
								if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column3 !== 'undefined') {
									mmsid = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column3[0];
								}
								if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column2 !== 'undefined') {
									isbn = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column2[0].split(';')[0];
								}
								if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column4 !== 'undefined') {
									title = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column4[0];
								}
								if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column5!== 'undefined') {
									activationdate = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column5[0];
								}
								if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column6!== 'undefined') {
									publicationdate = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column6[0];
								}
								if (typeof result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column1 !== 'undefined') {
									dewey = result.report.QueryResult[0].ResultXml[0].rowset[0].Row[index].Column1[0];
								}
								//samla alla inserts i array och gör bara ett anrop efter iterationen är färdig.
								booksarray.push([mmsid, '', isbn, title, activationdate, publicationdate, dewey, '', '', '', 'P']);
							}
							sql = "INSERT INTO newbooks(mmsid, recordid, isbn, title, activationdate, publicationdate, dewey, subject, category, subcategory, booktype) VALUES ?";
							con.query(sql, [booksarray]);
							currentdate = new Date();
							fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest, Inserted " + booksarray.length + " rows \n", function (err) {
								if (err) throw err;
							});
							console.log("inserted " + booksarray.length + " rows");
							nrofprocessedrecords = nrofprocessedrecords + booksarray.length;
							console.log("nrofprocessedrecords " +nrofprocessedrecords);
							//max xxx titlar
							if(IsFinished == 'false' && nrofprocessedrecords < 500) {
								callalmaanalytics_P(endpoint, latestactivationdate, token, nrofprocessedrecords, con);
							} else {
								//Alla titlar hämtade och tillagda i tabellen newbooks
								sql = `SELECT * FROM newbooks 
										WHERE booktype = 'P'
										AND activationdate > '${latestactivationdate}'
										ORDER BY activationdate DESC 
										LIMIT 500`
								con.query(sql, function (error, result, fields) {
									if (error) {
										currentdate = new Date();
										fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest, Error selecting " + error + "\n", function (err) {
											if (err) throw err;
										});
									} else {
										callprimoxservice(result, 0, 'P', con);
									}
								});
							}
						} else {
							currentdate = new Date();
							fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest, No new books to harvest! \n", function (err) {
								if (err) throw err;
							});
							fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest, Finished! \n", function (err) {
								if (err) throw err;
							});
							console.log("No new books to harvest!");
							con.rollback(function() {
							});
						}

					}
				} catch(err) {
					console.log("Error calling alma analytics P")
					console.log(err)
				}
			});
	});
	}).on("error", (err) => {
		console.log("Error: " + err.message);
	});
}

async function createnewbooksrecords(booktype) {
	try {
		let latestactivationdate
		let currentdate

		database.db.getConnection(async function(error, con) {
			
				if (process.env.FORCEACTIVATIONDATE) {
					latestactivationdate = process.env.FORCEACTIVATIONDATE
				} else {
					latestactivationdate = await getLatestActivationDate(con)
				}
				if (latestactivationdate === null) {
					var today = new Date();
					var dd = addZero(today.getDate());

					var mm = addZero(today.getMonth()+1); 
					var yyyy = today.getFullYear();
					latestactivationdate = yyyy + '-' + mm + '-' + dd;
				}

				//Start transaction!
				con.beginTransaction();
				
				if (process.env.DELETEBOOKS === 'TRUE') {
					const deletebooks = await deleteBooks(booktype, con)
				}

				currentdate = new Date();
				fs.appendFile(appath + 'harvest.log', addZero(currentdate.getHours()) + ":" + addZero(currentdate.getMinutes()) + ":" + addZero(currentdate.getSeconds()) + " Harvest started." + "\n", function (err) {
					if (err) throw err;
				});

				if (booktype == 'E') {
					callalmaanalytics_E("", latestactivationdate, '', 0, con);
				} else if (booktype == 'P') {
					callalmaanalytics_P("", latestactivationdate, '', 0, con);
				} else {
					console.log("ange booktype!")
				}

		});
	} catch(err) {
		console.log("Error create new books")
		console.log(err)
	}

}

console.log(new Date().toLocaleString());
console.log("Almatools-tasks started");

if (process.env.CRON_PBOOKS_ACTIVE === 'true') {
	const pbooks = cron.schedule(process.env.CRON_PBOOKS, () => {
		console.log(new Date().toLocaleString());
		console.log("Cron Pbooks job started");
		createnewbooksrecords('P');	
	});
}

if (process.env.CRON_EBOOKS_ACTIVE === 'true') {
	const ebooks = cron.schedule(process.env.CRON_EBOOKS, () => {
		console.log(new Date().toLocaleString());
		console.log("Cron Ebooks job started");
		createnewbooksrecords('E');	
	});
}

if (process.env.CRON_TDIG_ACTIVE === 'true') {
	const alma_tdig = cron.schedule(process.env.CRON_TDIG, () => {
		let payload = {
			"parameter": [
				{
					"name": {
						"value": "task_ExportBibParams_outputFormat_string",
						"desc": null
					},
					"value": "TXT"
				},
				{
					"name": {
						"value": "task_ExportBibParams_maxSize_string",
						"desc": null
					},
					"value": "0"
				},
				{
					"name": {
						"value": "task_ExportBibParams_exportFolder_string",
						"desc": null
					},
					"value": "INSTITUTION"
				},
				{
					"name": {
						"value": "task_ExportParams_ftpConfig_string",
						"desc": null
					},
					"value": "28187006240002456"
				},
				{
					"name": {
						"value": "task_ExportParams_ftpSubdirectory_string",
						"desc": null
					},
					"value": ""
				},
				{
					"name": {
						"value": "task_ExportParams_interfaceName",
						"desc": null
					},
					"value": "false"
				},
				{
					"name": {
						"value": "task_ExportParams_filterInactivePortfolios",
						"desc": null
					},
					"value": "false"
				},
				{
					"name": {
						"value": "task_ExportParams_baseUrl",
						"desc": null
					},
					"value": "http://pmt-eu.hosted.exlibrisgroup.com/openurl/46KTH/46KTH_services_page?"
				},
				{
					"name": {
						"value": "set_id",
						"desc": null
					},
					"value": "2036151600002456"
				},
				{
					"name": {
						"value": "job_name",
						"desc": null
					},
					"value": "Export Electronic Portfolios - via API - Portfolios export Tdig"
				}
			]
		}
		console.log(new Date().toLocaleString());
		console.log("Alma Tdig Started");
		runAlma(process.env.ALMA_TDIG_JOB_PATH, payload);	
	});
}


function addZero(i) {
    if (i < 10) {
        i = "0" + i;
    }
    return i;
}
