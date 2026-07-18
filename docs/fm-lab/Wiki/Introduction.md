# Introduction

## Prologue

FileMaker development is facing a new paradigm: **solution structure must be readable and understandable by both humans and AI agents**. While many major programming environments have well-established ecosystems for code analysis, documentation and refactoring, FileMaker's proprietary format makes it hard to participate in that ecosystem — there is no native API to query a solution's structure programmatically. 

Several tools try to bridge this gap. Some serve human developer workflows very well, but many are not designed for scalable, agent-driven analysis or open extension. Most are closed source, which limits their adaptability in a rapidly evolving landscape.

This project takes a different approach. It converts the structure of a FileMaker solution — exported as SaXML — into a queryable DuckDB database. The relevant object types (scripts, fields, layouts, relationships, value lists, and more) land in dedicated tables, with **a universal catalog that links objects and their dependencies across the entire solution**. DuckDB's in-process engine makes this catalog fast enough for both interactive queries and **AI-driven analysis at scale**, without any database server setup. A REST API and a web client provide additional access layers for GUI and integration workflows.

The first release focuses on this core: reliable [XML conversion](katana-engine.md), a comprehensive **object catalog,** and a [modular architecture](Architecture.md) that is open source and **designed for extension**. Future releases will build on this foundation — the long-term goal is to become a solid developer tooling platform for the FileMaker space.

**Addendum:** [Claris has announced upcoming agentic coding functionality for FileMaker](https://www.claris.com/blog/2026/how-claris-is-building-for-what-comes-next) for the upcoming releases. This does not contradict the goals of this project, but rather emphasizes the need for a solid foundation for code analysis and tooling in the FileMaker ecosystem. The architecture of fm-lab is designed to be flexible and adaptable, so it can integrate with Claris's AI coding features as they evolve, while also providing value to developers who want to leverage AI tools in their workflows today.