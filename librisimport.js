require('dotenv').config({path:'almatools-tasks.env'})

const https = require('https');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const logger = require('./logger');

/**
 * 
 * @returns 
 */
const main = async (fromDate, toDate) => {
    let recordsArray;
    try {
        const filePath = path.join(__dirname, "librisexport.properties");
        const response = await getLibrisUpdates(filePath, fromDate, toDate);
        const result = await parseXml(response);

        if (!result.collection.record) {
            logger.warn("❌ Inga records hittades i XML-filen.");
            return { status: "no_records" };
        }

        recordsArray = Array.isArray(result.collection.record) ? result.collection.record : [result.collection.record];

        for (const record of recordsArray) {
            await processRecord(record);
            logger.info("------------------------------------------------");
        }

        return { status: "success" }
    } catch (error) {
        logger.error(`❌ Ett fel uppstod: ${error}`);
        return { status: "error", message: error.message, recordsArray: recordsArray };
    }
};

/**
 * 
 * @param {*} record 
 */
async function processRecord(record) {
    logger.info("➡ Sammanslagen post");

    const holdings = getHoldingsXml(record);
    const holdingsExists = holdings !== null;

    // Kör endast om holdings finns
    if (holdingsExists) {
        //Hämta typ
        const controlFieldValue_type = getControlFieldValue(record, '008');
        logger.info(`📌 Type: ${controlFieldValue_type.substring(24,25)}`);
        if(controlFieldValue_type.substring(24,25) === 'm') {
            logger.info("✅ TYP ÄR THESIS");
        }

        //Hämta bib_id
        const controlFieldValue_id = getControlFieldValue(record, '001');
        logger.info(`📌 bib_id: ${controlFieldValue_id}`);

        //const librisType = await getLibrisType(controlFieldValue_id)
        //console.log("📌 libris_type:", librisType);

        const other_system_number = getOtherSystemNumber(record, controlFieldValue_id);
        logger.info(`📌 other_system_number: ${other_system_number}`);

        // MARC 008/24
        // 24 - Nature of entire work (006/07)
        // # - Not specified
        // a - Abstracts/summaries
        // b - Bibliographies
        // c - Catalogs
        // d - Dictionaries
        // e - Encyclopedias
        // f - Handbooks
        // g - Legal articles
        // h - Biography
        // i - Indexes
        // k - Discographies
        // l - Legislation
        // m - Theses
        // n - Surveys of literature in a subject area
        // o - Reviews
        // p - Programmed texts
        // q - Filmographies
        // r - Directories
        // s - Statistics
        // t - Technical reports
        // u - Standards/specifications
        // v - Legal cases and case notes
        // w - Law reports and digests
        // y - Yearbooks
        // z - Treaties
        // 5 - Calendars
        // 6 - Comics/graphic novels
        // | - No attempt to code

        // Kör bara om typen är Thesis
        // Utöka till övriga senare?
        if(controlFieldValue_type.substring(24,25) === 'm') {
            // Kör bara om record inte finns i Alma
            // Uppdateringar hanteras i senare version
            const recordIdentifier = await checkIfExistsAlma(other_system_number);
            if (recordIdentifier) {
                logger.info(`✅ Bibliografisk post finns i Alma: ${recordIdentifier}`);
            } else {
                logger.info("❌ Bibliografisk post finns inte i Alma, importera post!");
                await createAlmaRecords(record, holdings);
            }
        } else {
            //Hantera andra typer
            logger.info("⚠ Libristyp är inte avhandling(Thesis)");
        }
    } else {
        logger.info("⚠ Holdings saknas i Libris.");
    }
}

/**
 * 
 * @param {*} filePath 
 * @returns 
 */
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

        return await makeHttpRequest(options, data);
    } catch (error) {
        logger.error(`❌ Misslyckades att hämta Librisuppdateringar: ${error}`);
        throw new Error(`Failed to get Libris updates: ${error}`);
    }
}

async function getLibrisType(bib_id) {
    try {
        const options = {
            hostname: process.env.LIBRIS_HOSTNAME,
            path: `/find.jsonld?meta.controlNumber=${bib_id}`,
            method: "GET",
            headers: {
                "Content-Type": "application/ld+json"
            },
        };

        type = await makeHttpRequest(options);
        return JSON.parse(type).items[0].instanceOf.genreForm[0]['@id'];
    } catch (error) {
        throw new Error(`Misslyckades att hämta libristyp: ${error}`);
    }
}

/**
 * 
 * @param {*} record 
 * @param {*} tag 
 * @returns 
 */
function getControlFieldValue(record, tag) {
    const controlField = record.controlfield.find((field) => field.$.tag === tag);
    return controlField ? controlField._ : null;
}

/**
 * 
 * @param {*} record 
 * @param {*} controlFieldValue 
 * @returns 
 */
function getOtherSystemNumber(record, controlFieldValue) {
    const dataField035 = extractSubfields(record, "035");
    const code9Subfields = dataField035.filter((sub) => sub.code === "9");

    return code9Subfields.length === 1 ? code9Subfields[0].value : `(LIBRIS)${controlFieldValue}`;
}

/**
 * 
 * @param {*} record 
 * @returns 
 */
function getHoldingsXml(record) {
    const dataField852 = extractDataFields(record, "852");

    if (dataField852.length === 0) return null;

    const holdingsXml = buildHoldingsXml(dataField852[0]);
    return holdingsXml;
}

/**
 * 
 * @param {*} record 
 * @param {*} holdingsXml 
 * @returns 
 */
async function createAlmaRecords(record, holdingsXml) {
    const builder = new xml2js.Builder();
    const xmlRecord = builder.buildObject({ record }).replace(/<\?xml[^>]*\?>\s*/, "").replace(/<record[^>]*>/, "<record>");

    const bibId = await createAlmaBib(xmlRecord);
    if (!bibId) {
        logger.error("❌ Bib kunde inte skapas.");
        return;
    }

    logger.info(`✅ Bib skapad i Alma: ${bibId}`);
    logger.info(xmlRecord);

    const holdingsId = await createAlmaHoldings(bibId, holdingsXml);
    if (!holdingsId) {
        logger.error("❌ Holding kunde inte skapas.");
        return;
    }

    logger.info(`✅ Holding skapad i Alma: ${holdingsId}`);
    logger.info(holdingsXml);

    const itemXml = buildItemXml();
    const itemId = await createAlmaItem(bibId, holdingsId, itemXml);

    if (itemId) {
        logger.info(`✅ Item skapad i Alma: ${itemId}`);
        logger.info(itemXml);
    } else {
        logger.error("❌ Item kunde inte skapas.");
    }
}

/**
 * 
 * @param {*} record 
 * @param {*} tag 
 * @returns 
 */
function extractSubfields(record, tag) {
    return record.datafield
        .filter((field) => field.$.tag === tag)
        .flatMap((field) => (Array.isArray(field.subfield) ? field.subfield : [field.subfield]))
        .map((sub) => ({ code: sub.$.code, value: sub._ }));
}

/**
 * 
 * @param {*} record 
 * @param {*} tag 
 * @returns 
 */
function extractDataFields(record, tag) {
    return record.datafield
        .filter((field) => field.$.tag === tag)
        .map((field) => ({
            ind1: field.$.ind1.trim(),
            ind2: field.$.ind2.trim(),
            subfields: Array.isArray(field.subfield) ? field.subfield.map((sub) => ({ code: sub.$.code, value: sub._ })) : [],
        }));
}

/**
 * 
 * @param {*} dataField 
 * @returns 
 */
function buildHoldingsXml(dataField) {
    let xml = `<holding>
                 <suppress_from_publishing>false</suppress_from_publishing>
                 <record>
                     <leader>#####nx##a22#####1n#4500</leader>
                     <controlfield tag="008">1011252u####8###4001uueng0000000</controlfield>
                     <datafield tag="852" ind1="${dataField.ind1}" ind2="${dataField.ind2}">`;

    const codeB = dataField.subfields.find((sub) => sub.code === "b");
    if (codeB) {
        xml += getLibraryCode(codeB.value);
    }
    
    const codeH = dataField.subfields.find((sub) => sub.code === "h");
    if (codeH) {
        xml += `<subfield code="h">${codeH.value}</subfield>`;
        xml += getLocationCode(codeH.value);
    }

    const codeJ = dataField.subfields.find((sub) => sub.code === "j");
    if (codeJ) {
        xml += `<subfield code="j">${codeJ.value}</subfield>`;
    }

    xml += `</datafield></record></holding>`;
    return xml;
}

/**
 * 
 * @param {*} value 
 * @returns 
 */
function getLocationCode(value) {
    switch (value) {
        case "Trita-diss.":
            return `<subfield code="c">hbdok3</subfield>`;
        case "Lic.":
            return `<subfield code="c">hblic3</subfield>`;
        default:
            return "";
    }
}

/**
 * 
 * @param {*} value 
 * @returns 
 */
function getLibraryCode(value) {
    switch (value) {
        case "T":
            return `<subfield code="b">MAIN</subfield>`;
        case "Te":
            return `<subfield code="b">TELGE</subfield>`;
        default:
            return "";
    }
}

/**
 * 
 * @returns 
 */
function buildItemXml() {
    const today = new Date().toISOString().split("T")[0];
    return `<?xml version="1.0" encoding="UTF-8"?>
            <item link="string">
                <item_data>
                    <physical_material_type>
                        <xml_value>THESIS</xml_value>
                    </physical_material_type>
                    <policy>
                        <xml_value>14_90_days</xml_value>
                    </policy>
                    <arrival_date>${today}</arrival_date>
                    <receiving_operator></receiving_operator>
                    <base_status>1</base_status>
                </item_data>
            </item>`;
}

/**
 * 
 * @param {*} options 
 * @param {*} body 
 * @returns 
 */
async function makeHttpRequest(options, body = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(`Error: Received status code ${res.statusCode}`);
                } else {
                    resolve(data);
                }
            });
        });

        req.on('error', (error) => reject(`Error during request: ${error}`));

        if (body) req.write(body);
        req.end();
    });
}

/**
 * 
 * @param {*} xmlString 
 * @returns 
 */
async function parseXml(xmlString) {
    return new Promise((resolve, reject) => {
        xml2js.parseString(xmlString, { explicitArray: false }, (err, result) => {
            if (err) reject(`Error parsing XML: ${err}`);
            else resolve(result);
        });
    });
}

/**
 * 
 * @param {*} controlFieldValue 
 * @returns 
 * 
 * Använder almas SRU
 * https://developers.exlibrisgroup.com/blog/how-to-configure-the-sru-integration-profile-and-structure-sru-retrieval-queries/
 */
async function checkIfExistsAlma(controlFieldValue) {
    const hostname = process.env.ALMA_SRU_HOSTNAME;
    const path = `/view/sru/46KTH_INST?version=1.2&operation=searchRetrieve&recordSchema=marcxml&query=alma.other_system_number=="${controlFieldValue}"`;

    try {
        const response = await makeHttpRequest({ hostname, path, method: "GET" });
        const result = await parseXml(response);
        return result.searchRetrieveResponse.numberOfRecords == 1 ? result.searchRetrieveResponse.records.record.recordIdentifier : false;
    } catch (err) {
        console.error(err);
        return false;
    }
}

/**
 * 
 * @param {*} path 
 * @param {*} record 
 * @returns 
 */
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
        return await parseXml(response);
    } catch (err) {
        console.error(err);
        console.error(record);
        logger.error(`❌ createAlmaRecord error: ${err} ${record}`);
        return false;
    }
}

/**
 * 
 * @param {*} record 
 * @returns 
 */
async function createAlmaBib(record) {
    const bibRecord = `<bib><suppress_from_publishing>false</suppress_from_publishing>${record}</bib>`;
    const path = `/almaws/v1/bibs?apikey=${process.env.ALMA_APIKEY}&validate=true&normalization=30990173100002456`;
    const result = await createAlmaRecord(path, bibRecord);
    return result?.bib?.mms_id || false;
}

/**
 * 
 * @param {*} mms_id 
 * @param {*} record 
 * @returns 
 */
async function createAlmaHoldings(mms_id, record) {
    const path = `/almaws/v1/bibs/${mms_id}/holdings?apikey=${process.env.ALMA_APIKEY}`;
    const result = await createAlmaRecord(path, record);
    return result?.holding?.holding_id || false;
}

/**
 * 
 * @param {*} mms_id 
 * @param {*} holdings_id 
 * @param {*} record 
 * @returns 
 */
async function createAlmaItem(mms_id, holdings_id, record) {
    const path = `/almaws/v1/bibs/${mms_id}/holdings/${holdings_id}/items?apikey=${process.env.ALMA_APIKEY}`;
    const result = await createAlmaRecord(path, record);
    return result?.item?.item_data?.pid || false;
}

module.exports = {
    main
}