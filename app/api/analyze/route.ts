// src/app/api/analyze/route.ts
import { NextResponse } from "next/server";
import { simpleGit } from "simple-git";
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
    const { url } = await req.json();
    log(`Processing repository URL: ${url}`);

    // Create encoder for streaming response
    const encoder = new TextEncoder();

    // Create a stream
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendMessage = async (message: object) => {
      const encoded = encoder.encode(JSON.stringify(message) + "\n");
      log(`Sending message: ${JSON.stringify(message)}`);
      await writer.write(encoded);
    };

    // Process repository in background
    log("Starting repository processing");
    processRepository(url, sendMessage)
      .catch(async (error) => {
        log(`Error during processing: ${error.message}`);
        await sendMessage({ error: error.message });
      })
      .finally(async () => {
        log("Closing stream writer");
        await writer.close();
      });

    log("Returning stream response");
    return new NextResponse(stream.readable);
  } catch (error: unknown) {
    log(
      `Error in POST handler: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function processRepository(
  url: string,
  sendMessage: (message: object) => Promise<void>
) {
  log("Creating temporary directory");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-"));
  log(`Temporary directory created: ${tempDir}`);

  try {
    // Clone repository
    log("Starting repository clone");
    await sendMessage({ progress: 5, status: "Cloning repository..." });

    const git = simpleGit();
    await git.clone(url, tempDir);
    log("Repository cloned successfully");

    await sendMessage({
      progress: 20,
      status: "Repository cloned successfully",
    });

    // Get all files recursively
    log("Scanning repository for files");
    await sendMessage({ progress: 25, status: "Scanning repository..." });

    const files = await getAllFiles(tempDir);
    const totalFiles = files.length;
    log(`Found ${totalFiles} files in repository`);

    let processedFiles = 0;

    await sendMessage({
      progress: 30,
      status: `Found ${totalFiles} files to analyze`,
    });

    // Process files in smaller batches
    const batchSize = 10;
    let currentBatch = "";

    // Process each file
    for (const file of files) {
      const relPath = path.relative(tempDir, file);
      const ext = path.extname(file);
      log(`Processing file: ${relPath}`);

      // Skip if file should be excluded
      if (
        EXCLUDED_FILES.includes(path.basename(file)) ||
        EXCLUDED_DIRS.some((dir) => relPath.includes(dir)) ||
        (!ALLOWED_EXTENSIONS.includes(ext) &&
          path.basename(file) !== "README.md")
      ) {
        log(`Skipping excluded file: ${relPath}`);
        continue;
      }

      // Read and format file content
      const content = await fs.readFile(file, "utf-8");
      log(`Read ${content.length} bytes from ${relPath}`);

      currentBatch += `// Path: ${relPath}\n${content}\n\n`;
      processedFiles++;

      // Send batch when it reaches the batch size or it's the last file
      if (processedFiles % batchSize === 0 || processedFiles === totalFiles) {
        log(`Sending batch of ${currentBatch.length} bytes`);
        await sendMessage({ content: currentBatch });
        currentBatch = "";

        const progress = 30 + Math.floor((processedFiles / totalFiles) * 65);
        await sendMessage({
          progress,
          status: `Processing files... (${processedFiles}/${totalFiles})`,
        });
      }
    }

    log("Processing complete");
    await sendMessage({ progress: 100, status: "Analysis complete!" });
  } catch (error: unknown) {
    log(
      `Error during processing: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
    throw error;
  } finally {
    // Cleanup
    log(`Cleaning up temporary directory: ${tempDir}`);
    await fs.rm(tempDir, { recursive: true, force: true });
    log("Cleanup complete");
  }
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
