require('dotenv').config({path:'almatools-tasks.env'})

const https = require('https');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const logger = require('./logger');
const { db } = require('./db');

/** ------------------------ Helpers / Utils ------------------------ **/

async function parseXml(xmlString) {
    return new Promise((resolve, reject) => {
        xml2js.parseString(xmlString, { explicitArray: false }, (err, result) => {
            if (err) reject(`Error parsing XML: ${err}`);
            else resolve(result);
        });
    });
}

function extractDataFields(record, tag) {
    return record.datafield
        .filter((field) => field.$.tag === tag)
        .map((field) => ({
            ind1: field.$.ind1.trim(),
            ind2: field.$.ind2.trim(),
            subfields: Array.isArray(field.subfield) ? field.subfield.map((sub) => ({ code: sub.$.code, value: sub._ })) : [],
        }));
}

function extractSubfields(record, tag) {
    return record.datafield
        .filter((field) => field.$.tag === tag)
        .flatMap((field) => (Array.isArray(field.subfield) ? field.subfield : [field.subfield]))
        .map((sub) => ({ code: sub.$.code, value: sub._ }));
}

function getControlFieldValue(record, tag) {
    const controlField = record.controlfield.find((field) => field.$.tag === tag);
    return controlField ? controlField._ : null;
}

function getOtherSystemNumber(record, controlFieldValue) {
    const dataField035 = extractSubfields(record, "035");
    const code9Subfields = dataField035.filter((sub) => sub.code === "9");

    return code9Subfields.length === 1 ? code9Subfields[0].value : `(LIBRIS)${controlFieldValue}`;
}

function buildHoldingsXml(dataField) {
    if (!dataField) return null;
    let xml = `<holding>
                 <suppress_from_publishing>false</suppress_from_publishing>
                 <record>
                     <leader>#####nx##a22#####1n#4500</leader>
                     <controlfield tag="008">1011252u####8###4001uueng0000000</controlfield>
                     <datafield tag="852" ind1="${dataField.ind1}" ind2="${dataField.ind2}">`;

    // Delfält b - Bibliotek//
    const codeB = dataField.subfields.find((sub) => sub.code === "b");
    if (codeB) {
        xml += getLibraryCode(codeB.value);
    }
    
    // Delfält h - hyllkod och c - placering //
    const codeH = dataField.subfields.find((sub) => sub.code === "h");
    if (codeH) {
        xml += getLocationCode(codeH.value);
        xml += `<subfield code="h">${codeH.value}</subfield>`;
    }
    
    // Delfält j - löpnummer //
    const codeJ = dataField.subfields.find((sub) => sub.code === "j");
    if (codeJ) {
        xml += `<subfield code="j">${codeJ.value}</subfield>`;
    }

    // Delfält l - uppställningsord //
    const codeL = dataField.subfields.find((sub) => sub.code === "l");
    if (codeL) {
        xml += `<subfield code="l">${codeL.value}</subfield>`;
    }

    xml += `</datafield></record></holding>`;
    return xml;
}

function getLocationCode(value) {
    const numericValue = parseFloat(value);
    if (!isNaN(numericValue)) {
        if (numericValue >= 1 && numericValue <= 515.352) {
            return `<subfield code="c">sgd</subfield>`;
        }
        if ((numericValue >= 515.353 && numericValue <= 793.74) || (numericValue >= 900 && numericValue <= 910.2)) {
            return `<subfield code="c">ngd</subfield>`;
        }
        if (numericValue >= 800 && numericValue <= 802) {
            return `<subfield code="c">hbd08</subfield>`;
        }
    } else {
        if (value.toLowerCase().includes("teknikhistoria")) {
            return `<subfield code="c">hbtek</subfield>`;
        } else if (value === "Trita-diss.") {
            return `<subfield code="c">hbdok3</subfield>`;
        } else if (value === "Lic.") {
            return `<subfield code="c">hblic3</subfield>`;
        } else {
            return `<subfield code="c">hbkla</subfield>`;
        }
    }
}

function getLibraryCode(value) {
    switch (value) {
        case "T":
            return `<subfield code="b">MAIN</subfield>`;
        default:
            return "";
    }
}

/** ------------------------ HTTP Requests ------------------------ **/

async function makeHttpRequest(options, body = null, timeoutMs = parseInt(process.env.HTTP_TIMEOUT_MS, 10) || 5000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        logger.debug(`➡️ Starting HTTP request to https://${options.hostname}${options.path}`);

        const req = https.request(options, (res) => {
            let data = '';

            logger.debug(`📡 Connected. Status code: ${res.statusCode}`);
            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                const duration = Date.now() - startTime;
                logger.debug(`✅ Request ended in ${duration}ms`);
                if (res.statusCode === 200 || res.statusCode === 204) {
                    resolve({
                        headers: res.headers,
                        body: data
                    });
                    
                } else {
                    reject(`Error: Received status code ${res.statusCode}`);
                }
            });
        });

        req.on('socket', (socket) => {
            socket.on('lookup', (err, address, family, host) => {
                logger.debug(`🔍 DNS lookup for ${host} -> ${address} (IPv${family})`);
            });

            socket.on('connect', () => {
                logger.debug('🔌 TCP connection established');
            });

            socket.on('secureConnect', () => {
                logger.debug('🔒 TLS handshake completed');
            });
        });

        req.on('error', (error) => reject(`Error during request: ${error}`));

        // 👇 timeout sätts här
        req.setTimeout(timeoutMs, () => {
            req.destroy(); // avbryt anslutningen
            reject(`Error: Request timed out after ${timeoutMs}ms`);
        });

        if (body) req.write(body);
        req.end();
    });
}

/** ------------------------ Libris ------------------------ **/

async function getLibrisToken () {
    const client_id=process.env.CLIENT_ID
    const client_secret=process.env.CLIENT_SECRET
    const grant_type=process.env.GRANT_TYPE

    const options = {
        hostname: process.env.LIBRIS_AUTH_HOSTNAME,
        path: `/oauth/token?client_id=` + client_id + `&client_secret=` + client_secret + `&grant_type=` + grant_type,
        method: 'POST',
        headers: {
            "content-type":"application/x-www-form-urlencoded",
        },
    };
    
    try {
        const response = await makeHttpRequest(options);
        return response.body;
    } catch (err) {
        console.error(err);
        logger.error(`❌ getLibrisToken error: ${err}`);
        return false;
    }
}

async function getLibrisRecord (id) {
    const options = {
        hostname: process.env.LIBRIS_HOSTNAME,
        path: `/${id}`,
        method: 'GET',
        headers: {
            "content-type":"application/json",
            "Accept":"application/ld+json"
        },
    };
    
    try {
        const response = await makeHttpRequest(options);
        return response;
    } catch (err) {
        console.error(err);
        logger.error(`❌ getLibrisToken error: ${err}`);
        return false;
    }
}

async function updateLibrisHolding (id, etag, token, librisbody) {

    const options = {
        hostname: process.env.LIBRIS_HOSTNAME,
        path: `/${id}`,
        method: 'PUT',
        headers: {
            "content-type":"application/ld+json",
            "XL-Active-Sigel":"T",
            "If-Match": etag,
            "Authorization":"Bearer " + token
        }
    };
    
    const librisbodyParsed = JSON.parse(librisbody);
    const filtered = {
        "@graph": librisbodyParsed["@graph"].filter(node => 
            (node["@type"] === "Record" || node["@type"] === "Item") &&
            !node["@graph"] // uteslut de som har inre @graph
        )
    };

    // Leta upp cataloguersNote
    filtered["@graph"].forEach(entry => {
        if (Array.isArray(entry.hasComponent)) {
            entry.hasComponent.forEach(component => {
                if (component.cataloguersNote) {
                    component.cataloguersNote = null;
                    logger.info(`✅ Katalogisatörens notering med component raderad`);
                }
            });
        } else {
            if (entry.cataloguersNote) {
                entry.cataloguersNote = null;
                logger.info(`✅ Katalogisatörens notering utan komponent raderad`);
            }
        }
    });

    try {
        const response = await makeHttpRequest(options, JSON.stringify(filtered));
        return true;
    } catch (err) {
        console.error(err);
        logger.error(`❌ updateLibrisHolding error: ${err}`);
        return false;
    }
}

async function getLibrisUpdates(filePath, fromDate, toDate) {
    try {
        const data = await new Promise((resolve, reject) => {
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    reject('Could not read the file:', err);
                } else {
                    resolve(data);
                }
            });
        });
        const options = {
            hostname: process.env.LIBRIS_HOSTNAME,
            path: `/api/marc_export?from=${fromDate}Z&until=${toDate}Z&deleted=ignore&virtualDelete=false`,
            method: "POST",
            headers: {
                "Content-Type": "application/octet-stream",
                "Content-Length": data.length,
            },
        };
        const response = await makeHttpRequest(options, data);
        return response.body;
    } catch (error) {
        logger.error(`❌ Misslyckades att hämta Librisuppdateringar: ${error}`);
        throw new Error(`Failed to get Libris updates: ${error}`);
    }
}

/** ------------------------ Alma ------------------------ **/

async function createAlmaRecords(record, holdingsXml, bibExistsInAlma, type) {
    const builder = new xml2js.Builder();
    const xmlRecord = builder.buildObject({ record }).replace(/<\?xml[^>]*\?>\s*/, "").replace(/<record[^>]*>/, "<record>");


    let mmsId
    if(!bibExistsInAlma) {
        ////////////////////////////////////////
        // Skapa Bib(om den inte redan finns) //
        ////////////////////////////////////////
        logger.info("✅  Bibliografisk post finns inte i Alma, Skapa bib!");
        logger.info(`✅ xmlRecord: ${xmlRecord}`);
        mmsId = await createAlmaBib(xmlRecord);
        if (!mmsId) {
            logger.error("❌ Bib kunde inte skapas.");
            return false;
        }

        logger.info(`✅ Bib skapad i Alma mms_id: ${mmsId}`);
    } else {
        ////////////////////////////////////////
        // Uppdatera Bib(om den redan finns) //
        ////////////////////////////////////////
        mmsId = bibExistsInAlma
        logger.info(`✅ Bibliografisk post finns i Alma, uppdaterar bib mmsId: ${mmsId}`);
        logger.info(`✅ xmlRecord: ${xmlRecord}`);
        const updatedmmsId = await updateAlmaBib(xmlRecord, mmsId);
        if (!updatedmmsId) {
            logger.error("❌ Bib kunde inte uppdateras.");
            return false;
        }
        logger.info(`✅ Bib uppdaterad i Alma mms_id: ${updatedmmsId}`);
    }

    /////////////////////////////////////////////
    // Om Bib skapats eller uppdaterats        //
    // fortsätt med att skapa Holding och Item //
    /////////////////////////////////////////////

    if (type === 'THESIS') {
        ///////////////////////
        // Skapa Holding     //
        ///////////////////////
        logger.info(`✅ Skapa Holding i Alma, xmlRecord: ${holdingsXml}`);
        const holdingsId = await createAlmaHolding(mmsId, holdingsXml);

        if (!holdingsId) {
            logger.error("❌ Holding kunde inte skapas. mmsid: " + mmsId + ", holdingsxml: " + holdingsXml);
            return false;
        }

        logger.info(`✅ Holding skapad i Alma: ${holdingsId}`);

        ///////////////////////
        // Skapa Item        //
        ///////////////////////
        
        const itemXml = buildItemXml(type, '14_90_days');
        logger.info(`✅ Skapa Item i Alma, xmlRecord: ${itemXml}`);
        const itemId = await createAlmaItem(mmsId, holdingsId, itemXml);

        if (!itemId) {
            logger.error("❌ Item kunde inte skapas. mmsId:  " + mmsId + ", holdingsId: " + holdingsId + ", itemXml: " + itemXml);
            return false;
        }
        logger.info(`✅ Item skapad i Alma. itemId: ${itemId}`);
        return true;
    } else {
        /////////////////////
        // Skapa PO-Line   //
        // Endast för Book //
        /////////////////////
        
        //Hämta 040 ock kontrollera om det finns en subfield a med värdet "T" och subfield d med värdet "T"
        let importedbykth = false;
        let fortyA = false;
        let fortyD = false;
        const dataField040 = extractDataFields(record, "040");
        // Hämta alla subfields med code === "a"
        const codeAs = dataField040[0].subfields.filter((sub) => sub.code === "a");

        // Kolla om någon av dem har värdet "T"
        if (codeAs.some((sub) => sub.value === "T")) {
            fortyA = true;
        }
        // Hämta alla subfields med code === "a"
        const codeDs = dataField040[0].subfields.filter((sub) => sub.code === "d");

        // Kolla om någon av dem har värdet "T"
        if (codeDs.some((sub) => sub.value === "T")) {
            fortyD = true;
        }

        if (fortyA && fortyD) {
            importedbykth = true;
        }
        
        const polineXml = buildPolineXml(mmsId, importedbykth);
        const polineresult = await createAlmaPoLine(mmsId, polineXml);
        const polineId = polineresult?.po_line?.number || false;
        const holdingId = polineresult?.po_line?.locations?.location?.holdings?.holding?.id || false;

        if (polineId) {
            logger.info(`✅ PO Line skapad i Alma: ${polineId}`);
            logger.info(polineXml);
            if (holdingId) {
                logger.info(`✅ Holding ID från PO Line: ${holdingId}`);
                ////////////////////////////////////////////
                // Uppdatera holding med data från Libris //
                ////////////////////////////////////////////
                const resultUpdateAlmaHolding = await updateAlmaHolding(mmsId, holdingsXml, holdingId);
                if (resultUpdateAlmaHolding) {
                    logger.info(`✅ Holding i Alma uppdaterad med data från Libris: ${mmsId}`);
                    return true
                } else {
                    logger.error("❌ Holding i Alma kunde inte uppdateras.");
                    return false
                }
        
            }
        } else {
            logger.error("❌ PO Line kunde inte skapas.");
            return false
        }
    }
}

async function createAlmaRecord(path, record) {
    const options = {
        hostname: process.env.ALMA_API_HOSTNAME,
        path,
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml',
            'Content-Length': Buffer.byteLength(record),
        },
    };
    
    try {
        const response = await makeHttpRequest(options, record);
        return parseXml(response.body);
    } catch (err) {
        console.error(err);
        console.error(record);
        logger.error(`❌ createAlmaRecord error: ${err} ${record}`);
        return false;
    }
}

async function updateAlmaRecord(path, record) {
    const options = {
        hostname: process.env.ALMA_API_HOSTNAME,
        path,
        method: 'PUT',
        headers: {
            'Content-Type': 'application/xml',
            'Content-Length': Buffer.byteLength(record),
        },
    };
    
    try {
        const response = await makeHttpRequest(options, record);
        return parseXml(response.body);
    } catch (err) {
        console.error(err);
        console.error(record);
        logger.error(`❌ updateAlmaRecord error: ${err} ${record}`);
        return false;
    }
}

async function checkIfExistsAlma(controlFieldValue) {
    const hostname = process.env.ALMA_SRU_HOSTNAME;
    const path = `/view/sru/46KTH_INST?version=1.2&operation=searchRetrieve&recordSchema=marcxml&query=alma.other_system_number=="${controlFieldValue}"`;

    try {
        const response = await makeHttpRequest({ hostname, path, method: "GET" });
        const result = await parseXml(response.body);
        return result.searchRetrieveResponse.numberOfRecords == 1 ? result.searchRetrieveResponse.records.record.recordIdentifier : false;
    } catch (err) {
        console.error(err);
        return false;
    }
}

async function createAlmaPoLine(mms_id, po_line_object) {
    const options = {
        hostname: process.env.ALMA_API_HOSTNAME,
        path: `/almaws/v1/acq/po-lines/?apikey=${process.env.ALMA_APIKEY}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml',
            'Content-Length': Buffer.byteLength(po_line_object),
        },
    };
    
    try {
        const response = await makeHttpRequest(options, po_line_object);
        const result = await parseXml(response.body);
        return result || false;
    } catch (err) {
        console.error(err);
        console.error(po_line_object);
        logger.error(`❌ createAlmaPoline error: ${err} ${po_line_object}`);
        return false;
    }
}

async function createAlmaBib(record) {
    const bibRecord = `<bib><suppress_from_publishing>false</suppress_from_publishing>${record}</bib>`;
    const path = `/almaws/v1/bibs?apikey=${process.env.ALMA_APIKEY}&validate=true&normalization=30990173100002456`;
    const result = await createAlmaRecord(path, bibRecord);
    return result?.bib?.mms_id || false;
}

async function updateAlmaBib(record, mmsId) {
    const bibRecord = `<bib><suppress_from_publishing>false</suppress_from_publishing>${record}</bib>`;
    const path = `/almaws/v1/bibs/${mmsId}?apikey=${process.env.ALMA_APIKEY}&validate=true&normalization=30990173100002456`;
    const result = await updateAlmaRecord(path, bibRecord);
    return result?.bib?.mms_id || false;
}

async function updateAlmaHolding(mms_id, record, holding_id) {
    const path = `/almaws/v1/bibs/${mms_id}/holdings/${holding_id}?apikey=${process.env.ALMA_APIKEY}`;
    const result = await updateAlmaRecord(path, record);
    return result || false;
}
/*
async function updateAlmaItem(mms_id, record, holding_id) {
    const path = `/almaws/v1/bibs/${mms_id}/holdings/${holding_id}/items/${item_id}?apikey=${process.env.ALMA_APIKEY}`;
    const result = await updateAlmaRecord(path, record);
    return result?.holding?.holding_id || false;
}
*/

async function createAlmaHolding(mms_id, record) {
    const path = `/almaws/v1/bibs/${mms_id}/holdings?apikey=${process.env.ALMA_APIKEY}`;
    const result = await createAlmaRecord(path, record);
    return result?.holding?.holding_id || false;
}

async function createAlmaItem(mms_id, holdings_id, record) {
    const path = `/almaws/v1/bibs/${mms_id}/holdings/${holdings_id}/items?apikey=${process.env.ALMA_APIKEY}`;
    const result = await createAlmaRecord(path, record);
    return result?.item?.item_data?.pid || false;
}

const alma = {
    createBib: xml => createAlmaRecord(`/almaws/v1/bibs?apikey=${process.env.ALMA_APIKEY}&validate=true&normalization=30990173100002456`, `<bib><suppress_from_publishing>false</suppress_from_publishing>${xml}</bib>`),
    updateBib: (xml, mmsId) => updateAlmaRecord(`/almaws/v1/bibs/${mmsId}?apikey=${process.env.ALMA_APIKEY}&validate=true&normalization=30990173100002456`, `<bib><suppress_from_publishing>false</suppress_from_publishing>${xml}</bib>`),
    createHolding: (mmsId, xml) => createAlmaRecord(`/almaws/v1/bibs/${mmsId}/holdings?apikey=${process.env.ALMA_APIKEY}`, xml),
    updateHolding: (mmsId, holdingId, xml) => updateAlmaRecord(`/almaws/v1/bibs/${mmsId}/holdings/${holdingId}?apikey=${process.env.ALMA_APIKEY}`, xml),
    createItem: (mmsId, holdingId, xml) => createAlmaRecord(`/almaws/v1/bibs/${mmsId}/holdings/${holdingId}/items?apikey=${process.env.ALMA_APIKEY}`, xml),
    createPoLine: (mmsId, xml) => createAlmaRecord(`/almaws/v1/acq/po-lines/?apikey=${process.env.ALMA_APIKEY}`, xml)
};

/** ------------------------ DB ------------------------ **/

function saveFailedLibrisRecord(record, librisId, type) {
  const query = `INSERT INTO libris_import_failed_records (libris_id, record_type, record) VALUES (?, ?, ?)`;
  db.query(query, [librisId, type, record], (err) => {
    if (err) logger.error('❌ Kunde inte spara misslyckad post i DB', err);
    else logger.info(`💾 Misslyckad post sparad i DB, librisId: ${librisId}`);
  });
}

/** ------------------------ Main Processing ------------------------ **/

async function processRecord(record) {
    logger.info("➡ Sammanslagen post");

    const holdingsXml = buildHoldingsXml(extractDataFields(record, '852')[0]);

    // Kör endast om holdings finns
    if (!holdingsXml) return logger.info(`⚠ Holdings saknas i Libris: ${librisId}`);

    //Hämta librisId
    const librisId = getControlFieldValue(record, '001');
    //Hämta typ
    const controlFieldValue_type = getControlFieldValue(record, '008');
    logger.info(`📌 Type: ${controlFieldValue_type.substring(24,25)}`);
    if(controlFieldValue_type.substring(24,25) === 'm') {
        logger.info("✅ TYP ÄR THESIS");
    }

    
    logger.info(`📌 libris_id: ${librisId}`);

    const other_system_number = getOtherSystemNumber(record, librisId);
    logger.info(`📌 other_system_number: ${other_system_number}`);

    if(controlFieldValue_type.substring(24,25) === 'm') {
        logger.info("✅ Libristyp är avhandling(Thesis)");

        try {
            // Kör bara om record inte finns i Alma
            // Uppdateringar för thesis hanteras i senare version
            const bibExistsInAlma = await checkIfExistsAlma(other_system_number);
            if (bibExistsInAlma) {
                logger.info(`✅ Bibliografisk post för THESIS finns i Alma: ${bibExistsInAlma}`);
            } else {
                logger.info("❌ Bibliografisk post för THESIS finns inte i Alma, importera post!");
                const createResult = await createAlmaRecords(record, holdingsXml, bibExistsInAlma, 'THESIS');
                if (createResult) {
                    logger.info("✅ Thesis skapad i Alma");
                } else {
                    throw new Error("❌ Thesis kunde inte skapas i Alma");
                }
            }
        } catch (err) {
            throw err;
        }
    } else {
        /////////////////////////////// Hantera Book ////////////////////////////////////////////////////////
        // Övriga poster som ska importeras ska vara markerade med 852 x = 1 (katalogisatörens anmärkning) //
        // Posten ska bara hanteras en gång så att inte multipla holdings- och items skapas                //
        /////////////////////////////////////////////////////////////////////////////////////////////////////
        const dataField852 = extractDataFields(record, "852");
        const codeX = dataField852[0].subfields.find((sub) => sub.code === "x");
        if (codeX?.value === "1") {
            logger.info("❌ Bok markerad med 1 av katalogisatör, importera post");
            try {
                const bibExistsInAlma = await checkIfExistsAlma(other_system_number);
                
                logger.info(`❌ Importerar post! Exists: ${bibExistsInAlma}`);
                const createResult = await createAlmaRecords(record, holdingsXml, bibExistsInAlma, 'BOOK');
                //////////////////////////////////////////////// 
                // Om posten skapats/uppdaterats i Alma       //
                // Ta bort katalogisatörens anmärkning 1 från //
                // holdings i Libris(852x)                    //
                ////////////////////////////////////////////////
                if (createResult) {
                    // Hämta Libris token
                    const libristoken = await getLibrisToken();
                    if (!libristoken) {
                        logger.error("❌ Kunde inte hämta Libris token");
                        return;
                    } else {  
                        const marc = record;
                        // Extrahera ID från record
                        // Kontrollera i fält 887 om det finns en subfield 5 med värdet "T" (Libris)
                        // och hämta id från subfield a
                        const id = marc.datafield
                            .filter(df => df.$.tag === "887")
                            .filter(df => {
                                const subfields = Array.isArray(df.subfield) ? df.subfield : [df.subfield];
                                return subfields.some(sf => sf.$.code === "5" && sf._ === "T");
                            })
                            .map(df => {
                                const subfields = Array.isArray(df.subfield) ? df.subfield : [df.subfield];
                                const aField = subfields.find(sf => sf.$.code === "a");
                                if (aField && aField._) {
                                const jsonData = JSON.parse(aField._);
                                return jsonData["@id"];
                                }
                                return null;
                            })
                            .find(Boolean) || null;

                        // Hämta Holdingsrecord från Libris XL
                        const librisRecord = await getLibrisRecord(id);

                        //Ta bort "1" från holdings 852x(katalogisatörens anmärkning) i Libris XL
                        const updateLibrisHoldingResult = await updateLibrisHolding(id, librisRecord.headers.etag, JSON.parse(libristoken).access_token, librisRecord.body)
                        if (!updateLibrisHoldingResult) {
                            logger.error("❌ Katalogisatörens anmärkning 1 kunde inte tas bort från holdings i Libris");
                        } else {
                            logger.info("✅ Katalogisatörens anmärkning 1 borttagen från holdings i Libris");
                        }
                    }
                    logger.info("✅ Bok skapad i Alma");
                } else {
                    throw new Error("❌ Bok kunde inte skapas i Alma");
                }
            } catch (err) {
                throw err;
            }     
        } else {
            logger.info("❌ Bok uppfyller inga kriterier för att importeras.");
        }
        //Hantera andra typer?
        
    }
}

const main = async (fromDate, toDate) => {
    let recordsArray;
    try {
        const filePath = path.join(__dirname, "librisexport.properties");
        const response = await getLibrisUpdates(filePath, fromDate, toDate);
       
        const result = await parseXml(response);

        if (!result.collection.record) {
            logger.info("ℹ️ Inga records hittades i XML-filen.", response);
            return { status: "no_records" };
        }

        recordsArray = Array.isArray(result.collection.record) ? result.collection.record : [result.collection.record];

        logger.info(`ℹ️ Hittade ${recordsArray.length} poster att bearbeta`);

        for (const record of recordsArray) {
            const librisId = getControlFieldValue(record, '001'); // identifierare
            let type = 'UNKNOWN';

            const controlFieldValue_type = getControlFieldValue(record, '008');
            if (controlFieldValue_type && controlFieldValue_type.substring(24, 25) === 'm') {
                type = 'THESIS';
            } else {
                // Kolla 852 x = 1 för BOOK
                const dataField852 = extractDataFields(record, "852");
                const codeX = dataField852[0]?.subfields.find((sub) => sub.code === "x");
                if (codeX?.value === "1") {
                    type = 'BOOK';
                }
            }

            try {
                logger.info(`🔄 Bearbetar post: ${librisId} (Typ: ${type})`);
                await processRecord(record);
                logger.info(`✅ Post hanterad utan fel: ${librisId}`);
            } catch (err) {
                // Om fel uppstår, spara posten för retry
                logger.error(`❌ Fel vid bearbetning av post ${librisId}: ${err.message}`);
                saveFailedLibrisRecord(JSON.stringify(record), librisId, type);
            }
            logger.info("------------------------------------------------");
        }

        return { status: "success" }
    } catch (error) {
        logger.error(`❌ Ett fel uppstod: ${error.stack}`);
        return { status: "error", message: error.message, recordsArray: recordsArray };
    }
};

/** ------------------------ XML Builders ------------------------ **/

function buildItemXml(materialtype, policy) {
    const today = new Date().toISOString().split("T")[0];
    return `<?xml version="1.0" encoding="UTF-8"?>
            <item link="string">
                <item_data>
                    <physical_material_type>
                        <xml_value>${materialtype}</xml_value>
                    </physical_material_type>
                    <policy>
                        <xml_value>${policy}</xml_value>
                    </policy>
                    <arrival_date>${today}</arrival_date>
                    <receiving_operator></receiving_operator>
                    <base_status>1</base_status>
                </item_data>
            </item>`;
}

function buildPolineXml(mmsId, importedbykth) {

    const today = new Date();
    today.setDate(today.getDate() + 14);
    const expected_receipt_date = today.toISOString().split('T')[0];
    // Dagens datum i format YYYYMMDD
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const formattedDate = `${yyyy}${mm}${dd}`;
    const receivingNote = importedbykth ? `<receiving_note>${formattedDate} Importerad Libris</receiving_note>` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
            <po_line link="string">
                <owner>MAIN</owner>
                <type>PRINTED_BOOK_OT</type>
                <vendor>ADL</vendor>
                <vendor_account>ADL</vendor_account>
                <acquisition_method>VENDOR_SYSTEM</acquisition_method>
                <no_charge>true</no_charge>
                <resource_metadata>
                    <mms_id>${mmsId}</mms_id>
                </resource_metadata>
                <reporting_code>KTH</reporting_code>
	            <secondary_reporting_code>INKOP</secondary_reporting_code>
                ${receivingNote}
                <locations>
                    <location>
                        <quantity>1</quantity>
                        <library>MAIN</library>
                        <shelving_location>hbkla</shelving_location>
                        <copies>
                            <copy link="string">
                                <item_policy>14_90_days</item_policy>
                            </copy>
                        </copies>
                    </location>
                </locations>
                <material_type>BOOK</material_type>
            </po_line>`;
}

module.exports = {
    main, processRecord
}