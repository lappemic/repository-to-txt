import { NextResponse } from "next/server";
import { basename, extname } from 'path';

// Remove unused interface
interface FileSystemItem {
  path: string;
  type: "file" | "directory";
}

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

    const { owner, repo } = parseGitHubUrl(url);

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendMessage = async (message: object) => {
      const encoded = encoder.encode(JSON.stringify(message) + "\n");
      log(`Sending message: ${JSON.stringify(message)}`);
      await writer.write(encoded);
    };

    processRepository(owner, repo, sendMessage)
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

function parseGitHubUrl(url: string): { owner: string; repo: string } {
  // Remove trailing .git if present
  url = url.replace(/\.git$/, "");

  const match = url.match(/github\.com[/:]([\w-]+)\/([\w-]+)/);
  if (!match) {
    throw new Error("Invalid GitHub URL format");
  }
  return { owner: match[1], repo: match[2] };
}

async function getRepoContents(
  owner: string,
  repo: string,
  path: string = ""
): Promise<unknown[]> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Repository-To-Text-App",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return response.json();
}

async function getFileContent(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3.raw",
      "User-Agent": "Repository-To-Text-App",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch file content: ${response.statusText}`);
  }

  return response.text();
}

async function processRepository(
  owner: string,
  repo: string,
  sendMessage: (message: object) => Promise<void>
) {
  try {
    log("Starting repository processing");
    await sendMessage({
      progress: 5,
      status: "Fetching repository contents...",
    });

    const fileContents: { path: string; content: string }[] = [];
    const processedPaths = new Set<string>();

    const processContents = async (path: string = "") => {
      const contents = await getRepoContents(owner, repo, path);

      for (const item of contents as { path: string }[]) {
        if (processedPaths.has(item.path)) continue;
        processedPaths.add(item.path);

        if ((item as FileSystemItem).type === "directory") {
          if (!EXCLUDED_DIRS.some((dir) => item.path.includes(dir))) {
            await processContents(item.path);
          }
        } else if ((item as FileSystemItem).type === "file") {
          const ext = extname(item.path);
          if (
            !EXCLUDED_FILES.includes(basename(item.path)) &&
            (ALLOWED_EXTENSIONS.includes(ext) ||
              basename(item.path) === "README.md")
          ) {
            const content = await getFileContent((item as { path: string; download_url: string }).download_url);
            fileContents.push({ path: item.path, content });

            await sendMessage({
              progress: Math.min(
                90,
                5 + (fileContents.length * 85) / contents.length
              ),
              status: `Processing file: ${item.path}`,
            });
          }
        }
      }
    };

    await processContents();

    // Sort files by path and combine contents
    fileContents.sort((a, b) => a.path.localeCompare(b.path));

    let currentBatch = "";
    const batchSize = 10;

    for (let i = 0; i < fileContents.length; i++) {
      const { path: filePath, content } = fileContents[i];
      currentBatch += `// Path: ${filePath}\n${content}\n\n`;

      if ((i + 1) % batchSize === 0 || i === fileContents.length - 1) {
        await sendMessage({ content: currentBatch });
        currentBatch = "";

        const progress = 90 + Math.floor(((i + 1) / fileContents.length) * 10);
        await sendMessage({
          progress,
          status: `Processing files... (${i + 1}/${fileContents.length})`,
        });
      }
    }

    await sendMessage({ progress: 100, status: "Analysis complete!" });
  } catch (error: unknown) {
    log(
      `Error during processing: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    throw error;
  }
}

export const runtime = "nodejs";
