import { NextResponse } from "next/server";
import { download } from "@vercel/git-hooks";
import fs from "fs/promises";
import path from "path";
import os from "os";

const ALLOWED_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".py", ".json"];
const EXCLUDED_FILES = ["package-lock.json", "yarn.lock"];
const EXCLUDED_DIRS = ["node_modules", ".next", "__pycache__", ".git"];

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export async function POST(req: Request) {
  log("Received analyze request");

  try {
    let { url } = await req.json();
    log(`Processing repository URL: ${url}`);

    // Convert URL to standard GitHub HTTPS format
    url = convertToHttpsUrl(url);

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendMessage = async (message: object) => {
      const encoded = encoder.encode(JSON.stringify(message) + "\n");
      log(`Sending message: ${JSON.stringify(message)}`);
      await writer.write(encoded);
    };

    // Process repository in background
    processRepository(url, sendMessage)
      .catch(async (error) => {
        log(`Error during processing: ${error.message}`);
        await sendMessage({ error: error.message });
      })
      .finally(async () => {
        log("Closing stream writer");
        await writer.close();
      });

    return new NextResponse(stream.readable);
  } catch (error: unknown) {
    log(
      `Error in POST handler: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

function convertToHttpsUrl(url: string): string {
  // Remove trailing .git if present
  url = url.replace(/\.git$/, "");

  // Already HTTPS
  if (url.startsWith("https://")) {
    return url;
  }

  // Extract owner and repo from various formats
  let owner, repo;

  if (url.startsWith("git@github.com:")) {
    [owner, repo] = url.replace("git@github.com:", "").split("/");
  } else if (url.includes("/")) {
    [owner, repo] = url.split("/").slice(-2);
  } else {
    throw new Error("Invalid GitHub repository URL format");
  }

  return `https://github.com/${owner}/${repo}`;
}

async function processRepository(
  url: string,
  sendMessage: (message: object) => Promise<void>
) {
  log("Creating temporary directory");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-"));
  log(`Temporary directory created: ${tempDir}`);

  try {
    // Download repository using @vercel/git-hooks
    log("Starting repository download");
    await sendMessage({ progress: 5, status: "Downloading repository..." });

    const { owner, repo } = parseGitHubUrl(url);
    await download({
      repo: `https://github.com/${owner}/${repo}`,
      dir: tempDir,
    });

    log("Repository downloaded successfully");
    await sendMessage({
      progress: 20,
      status: "Repository downloaded successfully",
    });

    // Get all files recursively
    log("Scanning repository for files");
    await sendMessage({ progress: 25, status: "Scanning repository..." });

    const files = await getAllFiles(tempDir);
    const totalFiles = files.length;
    log(`Found ${totalFiles} files in repository`);

    let processedFiles = 0;
    const batchSize = 10;
    let currentBatch = "";

    await sendMessage({
      progress: 30,
      status: `Found ${totalFiles} files to analyze`,
    });

    // Process each file
    for (const file of files) {
      const relPath = path.relative(tempDir, file);
      const ext = path.extname(file);

      if (
        EXCLUDED_FILES.includes(path.basename(file)) ||
        EXCLUDED_DIRS.some((dir) => relPath.includes(dir)) ||
        (!ALLOWED_EXTENSIONS.includes(ext) &&
          path.basename(file) !== "README.md")
      ) {
        continue;
      }

      const content = await fs.readFile(file, "utf-8");
      currentBatch += `// Path: ${relPath}\n${content}\n\n`;
      processedFiles++;

      if (processedFiles % batchSize === 0 || processedFiles === totalFiles) {
        await sendMessage({ content: currentBatch });
        currentBatch = "";

        const progress = 30 + Math.floor((processedFiles / totalFiles) * 65);
        await sendMessage({
          progress,
          status: `Processing files... (${processedFiles}/${totalFiles})`,
        });
      }
    }

    await sendMessage({ progress: 100, status: "Analysis complete!" });
  } catch (error: unknown) {
    log(
      `Error during processing: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    throw error;
  } finally {
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function parseGitHubUrl(url: string) {
  const match = url.match(/github\.com[/:]([\w-]+)\/([\w-]+)/);
  if (!match) {
    throw new Error("Invalid GitHub URL format");
  }
  return { owner: match[1], repo: match[2] };
}

async function getAllFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getAllFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

export const runtime = "nodejs";
