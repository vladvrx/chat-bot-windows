if (process.platform === "darwin") await import("./package-macos.mjs");
else if (process.platform === "win32") await import("./package-windows.mjs");
else throw new Error(`Grok Bot packaging does not support ${process.platform}.`);
