const fs = require("fs");
const archiver = require("archiver");

function createZip(sourceDirectory, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("warning", (error) => {
      if (error.code !== "ENOENT") reject(error);
    });
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(sourceDirectory, false);
    archive.finalize();
  });
}

module.exports = { createZip };
