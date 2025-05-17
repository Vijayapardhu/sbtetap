const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Welcome to the Playwright API');
});

// ... Keep all your calculation functions (as-is) ...

app.post('/fetch-student-info', async (req, res) => {
  const { pin } = req.body;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 1. Go to first APSBTET page
    await page.goto('https://apsbtet.net/studentportal/screens/MainStudentInfo.aspx', {
      timeout: 60000,
      waitUntil: 'domcontentloaded'
    });

    await page.waitForTimeout(2000); // Wait a bit before interaction
    await page.fill('#ContentPlaceHolder1_txtpinno', pin);
    await page.click('#ContentPlaceHolder1_btngetunitmarks');
    await page.waitForSelector('#ContentPlaceHolder1_gvMArks', { timeout: 15000 });

    // Continue fetching data (same as your original logic)
    const name = await page.textContent('#ContentPlaceHolder1_lblName');
    const father = await page.textContent('#ContentPlaceHolder1_lblFather');
    
    const unitRows = await page.$$('#ContentPlaceHolder1_gvMArks tr');
    const unitMarks = [];
    const testsPerSubject = pin.startsWith('24') ? 3 : 2;
    const rowsPerTest = Math.floor(unitRows.length / testsPerSubject);

    for (let i = 0; i < rowsPerTest; i++) {
      const test1 = parseInt((await unitRows[i].$$eval('td', cells => cells[6]?.textContent?.trim())) || '0', 10);
      const test2 = parseInt((await unitRows[i + rowsPerTest].$$eval('td', cells => cells[6]?.textContent?.trim())) || '0', 10);
      const test3 = testsPerSubject === 3
        ? parseInt((await unitRows[i + 2 * rowsPerTest].$$eval('td', cells => cells[6]?.textContent?.trim())) || '0', 10)
        : 0;
      unitMarks.push([test1, test2, test3]);
    }

    const averagedUnitMarks = calculateDynamicAverageMarks(unitMarks, pin);

    await page.click('#ContentPlaceHolder1_btngetsessionmarks');
    await page.waitForSelector('#ContentPlaceHolder1_gvMArks', { timeout: 15000 });

    const sessionRows = await page.$$('#ContentPlaceHolder1_gvMArks tr');
    const sessionMarks = [];
    for (const row of sessionRows.slice(1)) {
      const cells = await row.$$('td');
      const cellTexts = await Promise.all(cells.map(cell => cell.textContent()));
      const obtainedMarks = parseInt(cellTexts[5]?.trim() || '0', 10);
      sessionMarks.push(obtainedMarks);
    }

    // Subject code generation, external mark calculations, etc.
    const totalUnitSubjects = averagedUnitMarks.length;
    const totalSessionSubjects = sessionMarks.length;

    const unitSubjectCodes = generateSubjectCodes(pin, pin.startsWith('24') ? 101 : 401, totalUnitSubjects);
    const sessionSubjectCodes = generateSubjectCodes(pin, unitSubjectCodes[unitSubjectCodes.length - 1] + 1, totalSessionSubjects);

    let totalInternalUnit = 0;
    let totalExternalUnit = 0;

    for (let i = 0; i < unitSubjectCodes.length; i++) {
      averagedUnitMarks[i] = Math.min(averagedUnitMarks[i], 80);
      const externalMarks = calculateExternalMarksForSubject(averagedUnitMarks[i], pin, unitSubjectCodes[i]);
      totalInternalUnit += averagedUnitMarks[i];
      totalExternalUnit += externalMarks;
    }

    let totalInternalSession = 0;
    let totalExternalSession = 0;

    for (let i = 0; i < sessionSubjectCodes.length; i++) {
      sessionMarks[i] = Math.min(sessionMarks[i], 80);
      const externalMarks = calculateExternalMarksForSubject(sessionMarks[i], pin, sessionSubjectCodes[i], true);
      totalInternalSession += sessionMarks[i];
      totalExternalSession += externalMarks;
    }

    const GrandTotal = totalInternalUnit + totalExternalUnit + totalInternalSession + totalExternalSession;

    // 2. Go to second APSBTET site (photo + branch)
    await page.goto('https://sbtet.ap.gov.in/APSBTET/registerInstant.do', {
      timeout: 60000,
      waitUntil: 'domcontentloaded',
    });

    await page.waitForTimeout(3000); // Wait before interacting
    await page.fill('#aadhar1', pin);
    await page.click('input[type="button"][value="GO"]');
    await page.waitForSelector('input.form-control-plaintext', { timeout: 10000 });

    const branch = await page.getAttribute('label:has-text("Branch") + div > input', 'value');
    const images = await page.$$('img');
    let photoBase64 = null;
    if (images.length >= 3) {
      const imgSrc = await images[2].getAttribute('src');
      if (imgSrc?.includes('data:image')) {
        photoBase64 = imgSrc.replace('data:image/jpg;base64,', '');
      }
    }

    const result = {
      name: name.trim(),
      pin: pin.toUpperCase().trim(),
      branch: branch?.trim() || '',
      photoBase64,
      totals: {
        totalInternalUnit,
        totalExternalUnit,
        totalInternalSession,
        totalExternalSession,
        GrandTotal,
      },
      unitResults: unitSubjectCodes.map((code, index) => {
        const internalMarks = averagedUnitMarks[index];
        const externalMarks = calculateExternalMarksForSubject(internalMarks, pin, code);
        const totalMarks = internalMarks + externalMarks;
        const { gradePoints, grade, status } = calculateGradeDetails(totalMarks);

        return {
          subjectCode: code,
          internalMarks,
          externalMarks,
          totalMarks,
          gradePoints,
          credits: 2.5,
          grade,
          status,
        };
      }),
      sessionResults: sessionSubjectCodes.map((code, index) => {
        const internalMarks = sessionMarks[index];
        const externalMarks = calculateExternalMarksForSubject(internalMarks, pin, code, true);
        const totalMarks = internalMarks + externalMarks;
        const { gradePoints, grade, status } = calculateGradeDetails(totalMarks);

        return {
          subjectCode: code,
          internalMarks,
          externalMarks,
          totalMarks,
          gradePoints,
          credits: 1.0,
          grade,
          status,
        };
      }),
    };

    fs.writeFileSync('student-info.json', JSON.stringify(result, null, 2));
    res.json(result);
  } catch (error) {
    console.error('ERROR:', error.message);
    res.status(500).json({ error: 'Failed to fetch student info', details: error.message });
  } finally {
    await browser.close();
  }
});

// Use process.env.PORT for Render compatibility
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});