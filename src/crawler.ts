import puppeteer from "puppeteer";
import fs from "fs-extra";
import path from "path";
import { JobDetail } from "./types";

const JOB_LIST_URL =
  "https://www.wanted.co.kr/wdlist/518/669?country=kr&job_sort=job.latest_order&years=-1&locations=all";
const DATA_DIR = path.join(__dirname, "../jobs");

fs.ensureDirSync(DATA_DIR);

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  // Set a real User-Agent to avoid detection
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  // Set a reasonable timeout for navigations
  page.setDefaultNavigationTimeout(30000);

  try {
    console.log(`Navigating to ${JOB_LIST_URL}...`);
    await page.goto(JOB_LIST_URL, { waitUntil: "networkidle2" });

    console.log("Scrolling to load jobs...");
    let uniqueLinks: string[] = [];
    let scrollAttempts = 0;
    const MAX_SCROLL_ATTEMPTS = 50;
    const TARGET_JOB_COUNT = 100;

    while (
      uniqueLinks.length < TARGET_JOB_COUNT &&
      scrollAttempts < MAX_SCROLL_ATTEMPTS
    ) {
      try {
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight)
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const currentLinks = await page.evaluate(() => {
          let anchors = Array.from(
            document.querySelectorAll('a[data-attribute-id="position__click"]')
          );
          if (anchors.length === 0) {
            anchors = Array.from(document.querySelectorAll('a[href^="/wd/"]'));
          }
          return anchors.map((a) => (a as HTMLAnchorElement).href);
        });

        uniqueLinks = [...new Set(currentLinks)];
        console.log(
          `Loaded ${uniqueLinks.length} unique jobs so far... (Attempt ${
            scrollAttempts + 1
          }/${MAX_SCROLL_ATTEMPTS})`
        );

        if (uniqueLinks.length === 0 && scrollAttempts === 5) {
          console.log(
            "Still 0 jobs after 5 attempts. Dumping list page HTML to debug_list_headless.html"
          );
          const html = await page.content();
          fs.writeFileSync(
            path.join(DATA_DIR, "debug_list_headless.html"),
            html
          );
        }
      } catch (scrollError) {
        console.error("Scroll error:", scrollError);
        break;
      }
      scrollAttempts++;
    }

    console.log(`Finished scrolling. Found ${uniqueLinks.length} unique jobs.`);
    const jobsToScrape = uniqueLinks.slice(0, TARGET_JOB_COUNT);
    console.log(`Will scrape ${jobsToScrape.length} jobs.`);

    for (const link of jobsToScrape) {
      let jobPage;
      try {
        const jobId = link.split("/").pop();
        if (!jobId) continue;

        console.log(`Scraping ${link}...`);
        jobPage = await browser.newPage();
        await jobPage.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        // Add error handling for individual page loads
        await jobPage.goto(link, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        // Wait a bit for hydrate
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const jobData: JobDetail = await jobPage.evaluate(() => {
          try {
            const nextDataToCheck = document.getElementById("__NEXT_DATA__");
            if (nextDataToCheck && nextDataToCheck.textContent) {
              const jsonData = JSON.parse(nextDataToCheck.textContent);
              const initialData = jsonData.props?.pageProps?.initialData;

              if (initialData) {
                const title = initialData.position || initialData.title || "";
                const company = initialData.company?.company_name || "";
                const location = initialData.address?.full_location || "";
                let description = "";

                if (initialData.main_tasks)
                  description += `[주요업무]\n${initialData.main_tasks}\n\n`;
                if (initialData.requirements)
                  description += `[자격요건]\n${initialData.requirements}\n\n`;
                if (initialData.preferred_points)
                  description += `[우대사항]\n${initialData.preferred_points}\n\n`;
                if (initialData.benefits)
                  description += `[혜택 및 복지]\n${initialData.benefits}\n\n`;

                return {
                  id: initialData.id ? String(initialData.id) : "",
                  title,
                  company,
                  location,
                  description,
                };
              }
            }
          } catch (e) {
            // ignore
          }

          // Fallback to DOM scraping
          const getText = (selector: string) =>
            document.querySelector(selector)?.textContent?.trim() || "";
          const title =
            document.querySelector("h1")?.textContent?.trim() ||
            "Unknown Title";
          const company =
            document.querySelector("h6 > a")?.textContent?.trim() || "";
          const location = getText(".JobHeader_className__...");
          const description =
            document
              .querySelector('section[class*="JobContent"]')
              ?.textContent?.trim() || "";

          return {
            id: "",
            title,
            company,
            location,
            description,
          };
        });

        if (!jobData.id) jobData.id = jobId;

        const filename = `${jobId}_${jobData.title.replace(
          /[^a-z0-9가-힣]/gi,
          "_"
        )}.txt`;
        const filePath = path.join(DATA_DIR, filename);

        const fileContent = `ID: ${jobData.id}\nTitle: ${jobData.title}\nCompany: ${jobData.company}\nLocation: ${jobData.location}\nURL: ${link}\n\n--- Content ---\n${jobData.description}`;

        fs.writeFileSync(filePath, fileContent);
        console.log(`Saved ${filename}`);

        await jobPage.close();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (err) {
        console.error(`Failed to scrape ${link}:`, err);
        if (jobPage && !jobPage.isClosed()) {
          try {
            await jobPage.close();
          } catch (e) {}
        }
      }
    }
  } catch (error) {
    console.error("Crawler failed:", error);
  } finally {
    await browser.close();
  }
}

run();
