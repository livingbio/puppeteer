const puppeteer = require('./index.js');

async function sleep(ms = 0) {
    return new Promise(r => setTimeout(r, ms));
}

(async () => {
    const browser = await puppeteer.launch({
        args: [
            '--headless',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--enable-surface-synchronization',
            '--run-all-compositor-stages-before-draw',
            '--disable-threaded-animation',
            '--disable-threaded-scrolling',
            '--disable-checker-imaging',
        ],
        deterministic: {
            date: new Date('Jan 01, 2000')
        },
        // executablePath: "/Users/davidchen/repo/gcomposer/node_modules/puppeteer/.local-chromium/mac-706915/chrome-mac/Chromium.app/Contents/MacOS/Chromium"
        // executablePath: "/Users/davidchen/repo/gcomposer/puppeteer-virtualtime/node_modules/puppeteer/.local-chromium/mac-543305/chrome-mac/Chromium.app/Contents/MacOS/Chromium"
    });
    console.log("chrome version is " + await browser.version() + " at: " + puppeteer.executablePath());
    const page = await browser.newPage();

    console.log(await page.evaluate('(new Date()).toLocaleString()'))
    await page.waitFor(5000)
    await sleep(5000)
    console.log(await page.evaluate('(new Date()).toLocaleString()'))

    await browser.close();
})();