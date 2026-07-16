
The only prerequisite on your machine is **[Docker](https://docs.docker.com/get-docker/)** — batteries included: DuckDB, Node.js and PATH setup all live inside the container.

```bash
git clone https://github.com/marcel-more/fm-lab.git
cd fm-lab
bash tools/fmlab.sh up  # answers two questions, then starts
```

`fmlab.sh up` asks **“Use Docker?”** and **“Start with the Claude Code agent?”**, brings the stack up in the background, and drops you straight into the product — the web client in your browser, or a live Claude Code session in the terminal.

Then **drop your FileMaker XML export** into `solutions/default/xml/` (FileMaker Pro ▸ Tools ▸ Save a Copy as XML — enable “Include details for analysis tools”; one file per solution file) and click **XML conversion** in the web client. 

**Done** — explore the object catalog, dependencies and the Graph Explorer.


---

Refer to [Installation](Installation.md) for more detailed setup infos.