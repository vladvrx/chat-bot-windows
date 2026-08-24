export interface ProcessErrorStream {
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
}

export function installWindowsProcessPipeGuards(
  platform: NodeJS.Platform = process.platform,
  streams: readonly ProcessErrorStream[] = [process.stdout, process.stderr],
): void {
  if (platform !== "win32") return;
  for (const stream of streams) {
    stream.on("error", (error) => {
      // A GUI-subsystem Windows launch has no console pipe. Node reports the
      // first console write as EPIPE; it must not abort Electron bootstrap.
      if (error.code === "EPIPE") return;
      throw error;
    });
  }
}
