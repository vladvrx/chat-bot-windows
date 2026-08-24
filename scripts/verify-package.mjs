if (process.platform === "darwin") await import("./verify.mjs");
else if (process.platform === "win32") await import("./verify-windows.mjs");
else throw new Error(`Grok Bot package verification does not support ${process.platform}.`);
