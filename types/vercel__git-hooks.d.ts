declare module "@vercel/git-hooks" {
  export interface DownloadOptions {
    repo: string;
    dir: string;
    branch?: string;
    shallow?: boolean;
  }

  export function download(options: DownloadOptions): Promise<void>;
}
