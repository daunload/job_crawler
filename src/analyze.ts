import { GoogleGenAI } from "@google/genai";
import fs from "fs-extra";
import path from "path";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;
const DATA_DIR = path.join(__dirname, "../jobs");
const OUTPUT_FILE = path.join(__dirname, "../tech_stack_summary.md");

if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set in .env file.");
  console.error(
    "Please create a .env file based on .env.example and add your API key."
  );
  process.exit(1);
}

const genAI = new GoogleGenAI({ apiKey: API_KEY });

async function runAnalysis() {
  try {
    console.log("Reading job files...");
    const files = await fs.readdir(DATA_DIR);
    const jobFiles = files.filter((f) => f.endsWith(".txt"));

    if (jobFiles.length === 0) {
      console.log("No job files found to analyze.");
      return;
    }

    console.log(`Found ${jobFiles.length} job files.`);

    let combinedContent = "";

    // Limit to 50 jobs for this pass to avoid hitting strict token limits if user has a lower tier key
    // or just to be safe. You can increase this.
    const filesToAnalyze = jobFiles.slice(0, 50);
    console.log(`Analyzing first ${filesToAnalyze.length} jobs...`);

    for (const file of filesToAnalyze) {
      const content = await fs.readFile(path.join(DATA_DIR, file), "utf-8");
      combinedContent += `--- JOB START: ${file} ---\n${content}\n--- JOB END ---\n\n`;
    }

    const prompt = `
        You are an expert technical recruiter and data analyst.
        I will provide you with the text of ${filesToAnalyze.length} job postings.
        
        Your task is to:
        1. Extract the key technical skills (Programming Languages, Frameworks, Libraries, Tools, Cloud Platforms) required or preferred in these jobs.
        2. Extract key competencies and soft skills (e.g., Problem Solving, Communication, Mentoring, Domain Knowledge, etc.) required by companies.
        3. Count the occurrences of each technology and competency across the jobs.
        4. Provide a summary report in Markdown format written in KOREAN.

        The Output format should be:
        # 기술 스택 및 역량 분석 보고서
        
        ## 상위 프로그래밍 언어
        (Table with Rank, Language, count)

        ## 상위 프레임워크 및 라이브러리
        (Table with Rank, Framework/Library, count)

        ## 상위 도구 및 플랫폼
        (Table with Rank, Tool/Platform, count)

        ## 주요 요구 역량 (Soft Skills & Competencies)
        (Table with Rank, Competency, count)
        (Brief description of why these are important based on the job descriptions)

        ## 주요 트렌드 및 인사이트
        (Brief qualitative summary of the trends observed in Korean, e.g., "React가 프론트엔드에서 지배적입니다", "문제 해결 능력이 가장 중요하게 언급됩니다", etc.)

        Here is the job data:
        ${combinedContent}
        `;
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text;

    await fs.writeFile(OUTPUT_FILE, text ?? "");
    console.log(`Analysis complete! Summary saved to ${OUTPUT_FILE}`);
  } catch (error) {
    console.error("Analysis failed:", error);
  }
}

runAnalysis();
