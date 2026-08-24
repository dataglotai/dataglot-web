// Post-build LLM-discoverability pipeline:
//  1. Walk the built sitemap, convert each page's <main> to Markdown next to
//     the page, and emit llms.txt grouped by section.
//  2. Re-export each source .md body (front matter stripped) for pages that
//     declare a slug.
//  3. Concatenate everything into llms-full.txt.
// Run after `zola build` (see build.sh).

const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const glob = require("fast-glob");
const xml2js = require("xml2js");
const cheerio = require("cheerio");
const TurndownService = require("turndown");

const contentDir = "content";
const publicDir = "public";
const sitemapPath = "public/sitemap.xml";
const siteBaseUrl = process.env.SITE_BASE_URL || "https://dataglot.ai";
const turndownService = new TurndownService();

const sections = {
  Docs: [],
  Guides: [],
  Blog: [],
  Other: [],
};

const baseHeader = `# Dataglot

> Dataglot is a Rust-native federated SQL query engine with governance
> enforced in the query plan. It speaks the PostgreSQL wire protocol, queries
> PostgreSQL, MySQL, Oracle, Snowflake, object storage and Apache Iceberg in
> place, and compiles column masks and row filters into the physical plan so
> masked data never leaves storage.

Source code: https://github.com/dataglotai/dataglot (Apache-2.0).
`;

function classifyUrl(url) {
  const pathname = new URL(url).pathname;
  if (pathname.startsWith("/docs/")) return "Docs";
  if (pathname.startsWith("/guides/")) return "Guides";
  if (pathname.startsWith("/blog/")) return "Blog";
  return "Other";
}

function getSlug(fileContent) {
  const match = fileContent.match(/^\s*slug\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

function getMarkdownBody(fileContent) {
  const frontMatterEndIndex = fileContent.indexOf("+++", 3);
  if (frontMatterEndIndex !== -1) {
    return fileContent.substring(frontMatterEndIndex + 3).trim();
  }
  return null;
}

function urlToFilePath(url) {
  const pathname = new URL(url).pathname;
  if (pathname === "/") {
    return { dir: publicDir, name: "index" };
  }
  const segments = pathname.split("/").filter(Boolean);
  const name = segments[segments.length - 1];
  const dir = path.join(publicDir, ...segments);
  return { dir, name };
}

async function generateMdFromSitemap() {
  console.log("\n--- Step 1: Generating Markdown files from sitemap... ---");
  try {
    const xml = fsSync.readFileSync(sitemapPath, "utf8");
    const result = await xml2js.parseStringPromise(xml);
    const urls = result.urlset.url.map((u) => u.loc[0]);
    console.log(`Found ${urls.length} URLs in sitemap.`);

    let processedCount = 0;

    for (const url of urls) {
      try {
        const htmlPath =
          publicDir + "/" + url.split(siteBaseUrl)[1] + "index.html";
        const file = fsSync.readFileSync(htmlPath, "utf8");
        const $ = cheerio.load(file);

        const title = $("title").text().trim();
        const main = $("main, .content, .post, article").first();
        main
          .find("header, footer, nav, .sidebar, .docs-sidebar, .docs-searchbar, script")
          .remove();
        if (!main.length) continue;

        const markdown = turndownService.turndown(main.html());

        const { dir, name } = urlToFilePath(url);
        fsSync.mkdirSync(dir, { recursive: true });

        const mdFileName = `${name}.md`;
        fsSync.writeFileSync(path.join(dir, mdFileName), markdown.trim());

        const mdUrl = url.endsWith("/")
          ? url + mdFileName
          : url + "/" + mdFileName;
        sections[classifyUrl(url)].push(`- [${title}](${mdUrl})`);
        processedCount++;
      } catch (err) {
        if (err.code !== "ENOENT") {
          console.error(`[ERROR] Failed to process ${url}: ${err.message}`);
        }
      }
    }

    let llms = baseHeader + "\n\n";
    for (const [sectionTitle, links] of Object.entries(sections)) {
      if (links.length === 0) continue;
      llms += `## ${sectionTitle}\n` + links.join("\n") + "\n\n";
    }

    fsSync.writeFileSync(path.join(publicDir, "llms.txt"), llms.trim());
    console.log(
      `✅ Step 1 complete. Processed ${processedCount} URLs and created 'llms.txt'.`
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn(`[SKIPPED] Sitemap not found: ${sitemapPath}.`);
    } else {
      console.error("An unexpected error occurred during Step 1:", error);
    }
  }
}

async function syncContentFromLocal() {
  console.log("\n--- Step 2: Syncing local content by 'slug'... ---");
  const markdownFiles = await glob(
    path.join(contentDir, "**/*.md").replace(/\\/g, "/")
  );
  let processedCount = 0;

  for (const sourcePath of markdownFiles) {
    const fileContent = await fs.readFile(sourcePath, "utf8");
    const slug = getSlug(fileContent);
    if (!slug) continue;

    const markdownBody = getMarkdownBody(fileContent);
    if (markdownBody === null) {
      console.warn(`[SKIPPED] No closing '+++' in: ${sourcePath}`);
      continue;
    }

    const relativeDir = path.dirname(path.relative(contentDir, sourcePath));
    const targetDir = path.join(publicDir, relativeDir, slug);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, `${slug}.md`), markdownBody);
    processedCount++;
  }
  console.log(`✅ Step 2 complete. Processed ${processedCount} slugged files.`);
}

async function combinePublicMarkdown() {
  console.log("\n--- Step 3: Combining all .md files... ---");
  const outputFile = path.join(publicDir, "llms-full.txt");
  const markdownFiles = await glob(
    path.join(publicDir, "**/*.md").replace(/\\/g, "/")
  );
  if (markdownFiles.length === 0) {
    console.log("No .md files found to combine.");
    return;
  }

  const allContents = [];
  for (const filePath of markdownFiles) {
    const content = await fs.readFile(filePath, "utf8");
    allContents.push(
      `\n\n--- START: ${path.relative(publicDir, filePath)} ---\n\n` + content
    );
  }
  await fs.writeFile(outputFile, allContents.join(""));
  console.log(`✅ Step 3 complete. Combined into '${outputFile}'.`);
}

async function runBuildPipeline() {
  console.log("🚀 Starting build pipeline...");
  await generateMdFromSitemap();
  await syncContentFromLocal();
  await combinePublicMarkdown();
  console.log("\n🎉 All steps completed successfully!");
}

runBuildPipeline().catch((error) => {
  console.error("\n❌ A critical error occurred during the pipeline:", error);
  process.exit(1);
});
