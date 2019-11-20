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
            // '--disable-threaded-animation',
            // '--disable-threaded-scrolling',
            // '--disable-checker-imaging',
        ],
        deterministic: {
            date: new Date('Jan 01, 2000')
        },
        // executablePath: "/Users/davidchen/repo/gcomposer/node_modules/puppeteer/.local-chromium/mac-706915/chrome-mac/Chromium.app/Contents/MacOS/Chromium"
        // executablePath: "/Users/davidchen/repo/gcomposer/puppeteer-virtualtime/node_modules/puppeteer/.local-chromium/mac-543305/chrome-mac/Chromium.app/Contents/MacOS/Chromium"
    });
    console.log("chrome version is " + await browser.version() + " at: " + puppeteer.executablePath());
    const page = await browser.newPage();
    var url = process.argv[2] || 'https://giant.gfycat.com/YoungOblongEmperorshrimp.webm';
    var record_time = process.argv[3] || 10000;
    var fps = process.argv[4] || 25;
    var step = 1000 / fps;

    console.log('capture ' + url + ' time ' + record_time + ' fps ' + fps);

    await page.goto(url, {
        waitUntil: 'networkidle0'
    });

    var total_time = record_time;

    for (var i = 0; i < total_time / step; i++) {
        console.log(await page.evaluate('(new Date()).toLocaleString()'))

        await sleep(100)
        await page.waitFor(step);
        await page.screenshot({ path: './tmp/' + i + '.jpg' });
    }

    await browser.close();
})();
