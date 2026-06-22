const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Przechowuje aktualnie trwające obietnice zapisu dla danego pliku (kolejkowanie - mutex per plik)
const writeLocks = new Map();

/**
 * Zwraca obietnicę, która rozwiązuje się, gdy plik będzie gotowy do zapisu,
 * a następnie blokuje plik dla kolejnych operacji.
 */
async function acquireLock(filePath) {
    if (writeLocks.has(filePath)) {
        try {
            await writeLocks.get(filePath);
        } catch (e) {
            // Ignorujemy błędy poprzedniej obietnicy przy oczekiwaniu
        }
    }
    
    let releaseLock;
    const lockPromise = new Promise(resolve => {
        releaseLock = resolve;
    });
    
    writeLocks.set(filePath, lockPromise);
    
    return () => {
        if (writeLocks.get(filePath) === lockPromise) {
            writeLocks.delete(filePath);
        }
        releaseLock();
    };
}

function getHash(data) {
    return crypto.createHash('md5').update(data).digest('hex');
}

async function readJSON(filePath, defaultData = null, withVersion = false) {
    const releaseLock = await acquireLock(filePath);
    try {
        if (!fs.existsSync(filePath)) {
            return withVersion ? { data: defaultData, version: null } : defaultData;
        }
        const data = fs.readFileSync(filePath, 'utf8');
        if (data.trim() === '') return withVersion ? { data: defaultData, version: null } : defaultData;
        
        const parsedData = JSON.parse(data);
        if (withVersion) {
            return { data: parsedData, version: getHash(data) };
        }
        return parsedData;
    } catch (error) {
        console.error(`KRYTYCZNY BŁĄD: Plik ${filePath} jest uszkodzony lub nieczytelny:`, error);
        throw error;
    } finally {
        releaseLock();
    }
}

async function writeJSON(filePath, data) {
    const releaseLock = await acquireLock(filePath);
    try {
        const tempFilePath = `${filePath}.${Date.now()}.${Math.floor(Math.random() * 100000)}.tmp`;
        const jsonData = JSON.stringify(data, null, 2);
        
        fs.writeFileSync(tempFilePath, jsonData, 'utf8');
        fs.renameSync(tempFilePath, filePath);
        
        return true;
    } catch (error) {
        console.error(`Błąd bezpiecznego zapisu pliku ${filePath}:`, error);
        throw error;
    } finally {
        releaseLock();
    }
}

async function updateJSON(filePath, updaterFn, defaultData = null, expectedVersion = null) {
    const releaseLock = await acquireLock(filePath);
    try {
        let currentData = defaultData;
        let fileContent = '';
        
        if (fs.existsSync(filePath)) {
            fileContent = fs.readFileSync(filePath, 'utf8');
            if (fileContent.trim() !== '') {
                try {
                    currentData = JSON.parse(fileContent);
                } catch (err) {
                    console.error(`KRYTYCZNY BŁĄD PARSOWANIA: Plik ${filePath} jest uszkodzony!`);
                    throw new Error(`Plik ${filePath} jest uszkodzony.`);
                }
            }
        }

        if (expectedVersion !== null && getHash(fileContent) !== expectedVersion) {
            const error = new Error('CONFLICT_VERSION');
            error.code = 'CONFLICT_VERSION';
            throw error;
        }

        const newData = await updaterFn(currentData);

        const tempFilePath = `${filePath}.${Date.now()}.${Math.floor(Math.random() * 100000)}.tmp`;
        const jsonData = JSON.stringify(newData, null, 2);
        
        fs.writeFileSync(tempFilePath, jsonData, 'utf8');
        fs.renameSync(tempFilePath, filePath);
        
        // Zwracamy nową wersję pliku – frontend może ją zapisać do następnego zapisu
        const newVersion = getHash(jsonData);
        return { data: newData, version: newVersion };
    } catch (error) {
        console.error(`Błąd aktualizacji pliku ${filePath}:`, error);
        throw error;
    } finally {
        releaseLock();
    }
}

/**
 * Skrót: odczytuje plik JSON wraz z wersją (hash MD5 zawartości).
 * Zwraca { data, version } — identycznie jak readJSON(path, default, true).
 */
async function readJSONWithVersion(filePath, defaultData = null) {
    return readJSON(filePath, defaultData, true);
}

module.exports = {
    readJSON,
    readJSONWithVersion,
    writeJSON,
    updateJSON,
    getHash,
};
