const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'main.html'));
});

// Function to generate a consistent random number based on a seed
function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Function to calculate external marks
function calculateExternalMarksForSubject(internal, pin, subjectCode, isSessional = false) {
  const seed = parseInt(`${pin}${subjectCode}`, 36);
  const randomAdjustment = Math.floor(seededRandom(seed) * 13) - 6;
  const baseMultiplier = 2.5;
  const subjectMultiplier = baseMultiplier + (parseInt(subjectCode) % 10) * 0.3;

  let externalMarks;
  switch (subjectCode) {
    case '401': externalMarks = Math.round(subjectMultiplier * internal + 18 + randomAdjustment); break;
    case '402': externalMarks = Math.round(subjectMultiplier * internal + 4 + randomAdjustment); break;
    case '403': externalMarks = Math.round(subjectMultiplier * internal + 13 + randomAdjustment); break;
    case '404': externalMarks = Math.round(subjectMultiplier * internal + 2 + randomAdjustment); break;
    case '405': externalMarks = Math.round(subjectMultiplier * internal + 5 + randomAdjustment); break;
    default:    externalMarks = Math.round(subjectMultiplier * internal + 6 + randomAdjustment); break;
  }

  internal = Math.min(internal, 80);
  return Math.max(0, Math.min(isSessional ? 60 : 80, externalMarks));
}

function generateSubjectCodes(pin, startCode, count) {
  return Array.from({ length: count }, (_, i) => startCode + i);
}

function calculateDynamicAverageMarks(marks, pin) {
  const averagedMarks = [];
  const testsPerSubject = pin.startsWith('24') ? 3 : 2;
  for (const subject of marks) {
    const test1 = subject[0] || 0;
    const test2 = subject[1] || 0;
    const test3 = testsPerSubject === 3 ? subject[2] || 0 : 0;
    const avg = Math.round((test1 + test2 + test3) / testsPerSubject);
    averagedMarks.push(avg);
  }
  return averagedMarks;
}

function calculateGradeDetails(totalMarks) {
  let grade, gradePoints;
  if (totalMarks >= 90)      { grade = 'A+'; gradePoints = 10; }
  else if (totalMarks >= 80) { grade = 'A';  gradePoints = 9; }
  else if (totalMarks >= 70) { grade = 'B+'; gradePoints = 8; }
  else if (totalMarks >= 60) { grade = 'B';  gradePoints = 7; }
  else if (totalMarks >= 50) { grade = 'C';  gradePoints = 6; }
  else if (totalMarks >= 40) { grade = 'D';  gradePoints = 5; }
  else                       { grade = 'F';  gradePoints = 0; }
  return { grade, gradePoints, status: totalMarks >= 28 ? 'P' : 'F' };
}

app.post('/fetch-student-info', async (req, res) => {
  const { pin } = req.body;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto('https://apsbtet.net/studentportal/screens/MainStudentInfo.aspx', {
      timeout: 60000,
      waitUntil: 'domcontentloaded',
    });

    await page.waitForTimeout(2000);
    await page.fill('#ContentPlaceHolder1_txtpinno', pin);
    await page.click('#ContentPlaceHolder1_btngetunitmarks');
    await page.waitForSelector('#ContentPlaceHolder1_gvMArks', { timeout: 20000 });

    const name = await page.textContent('#ContentPlaceHolder1_lblName');
    const father = await page.textContent('#ContentPlaceHolder1_lblFather');

    const unitRows = await page.$$('#ContentPlaceHolder1_gvMArks tr');
    const testsPerSubject = pin.startsWith('24') ? 3 : 2;
    const rowsPerTest = Math.floor(unitRows.length / testsPerSubject);

    const unitMarks = [];
    for (let i = 0; i < rowsPerTest; i++) {
      const test1 = parseInt((await unitRows[i].$$eval('td', c => c[6]?.textContent?.trim())) || '0', 10);
      const test2 = parseInt((await unitRows[i + rowsPerTest].$$eval('td', c => c[6]?.textContent?.trim())) || '0', 10);
      const test3 = testsPerSubject === 3
        ? parseInt((await unitRows[i + 2 * rowsPerTest].$$eval('td', c => c[6]?.textContent?.trim())) || '0', 10)
        : 0;
      unitMarks.push([test1, test2, test3]);
    }

    const averagedUnitMarks = calculateDynamicAverageMarks(unitMarks, pin);

    await page.click('#ContentPlaceHolder1_btngetsessionmarks');
    await page.waitForSelector('#ContentPlaceHolder1_gvMArks', { timeout: 20000 });

    const sessionRows = await page.$$('#ContentPlaceHolder1_gvMArks tr');
    const sessionMarks = [];
    for (const row of sessionRows.slice(1)) {
      const cells = await row.$$('td');
      const text = await Promise.all(cells.map(c => c.textContent()));
      sessionMarks.push(parseInt(text[5]?.trim() || '0', 10));
    }

    const unitCodes = generateSubjectCodes(pin, pin.startsWith('24') ? 101 : 401, averagedUnitMarks.length);
    const sessionCodes = generateSubjectCodes(pin, unitCodes[unitCodes.length - 1] + 1, sessionMarks.length);

    let totalInternalUnit = 0, totalExternalUnit = 0, totalInternalSession = 0, totalExternalSession = 0;

    const unitResults = unitCodes.map((code, i) => {
      const internal = Math.min(averagedUnitMarks[i], 80);
      const external = calculateExternalMarksForSubject(internal, pin, code);
      const total = internal + external;
      const g = calculateGradeDetails(total);
      totalInternalUnit += internal;
      totalExternalUnit += external;
      return { subjectCode: code, internalMarks: internal, externalMarks: external, totalMarks: total, ...g, credits: 2.5 };
    });

    const sessionResults = sessionCodes.map((code, i) => {
      const internal = Math.min(sessionMarks[i], 80);
      const external = calculateExternalMarksForSubject(internal, pin, code, true);
      const total = internal + external;
      const g = calculateGradeDetails(total);
      totalInternalSession += internal;
      totalExternalSession += external;
      return { subjectCode: code, internalMarks: internal, externalMarks: external, totalMarks: total, ...g, credits: 1.0 };
    });

    await page.goto('https://sbtet.ap.gov.in/APSBTET/registerInstant.do', {
      timeout: 60000,
      waitUntil: 'domcontentloaded'
    });

    await page.waitForTimeout(2000);
    await page.fill('#aadhar1', pin);
    await page.click('input[type="button"][value="GO"]');
    await page.waitForSelector('input.form-control-plaintext', { timeout: 15000 });

    const branch = await page.getAttribute('label:has-text("Branch") + div > input', 'value');
    const images = await page.$$('img');
    const imgSrc = images.length >= 3 ? await images[2].getAttribute('src') : null;
    const photoBase64 = imgSrc?.includes('data:image') ? imgSrc.replace('data:image/jpg;base64,', '') : null;

    const result = {
      name: name?.trim() || '',
      father: father?.trim() || '',
      pin: pin.toUpperCase().trim(),
      branch: branch?.trim() || '',
      photoBase64,
      unitResults,
      sessionResults,
      totals: {
        totalInternalUnit,
        totalExternalUnit,
        totalInternalSession,
        totalExternalSession,
        GrandTotal: totalInternalUnit + totalExternalUnit + totalInternalSession + totalExternalSession,
      },
    };

    fs.writeFileSync('student-info.json', JSON.stringify(result, null, 2));
    res.json(result);

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Failed to fetch student info', details: error.message });
  } finally {
    await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});