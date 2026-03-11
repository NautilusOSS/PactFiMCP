# empty-mcp

A minimal MCP (Model Context Protocol) server scaffold using stdio transport.

## Setup

```bash
npm install
```

## Usage

```bash
node index.js
```

## Adding to a Client

Add the following to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "empty-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/empty-mcp/index.js"]
    }
  }
}
```

## Adding Tools

Register tools on the server before it connects to the transport:

```javascript
server.tool("hello", { name: z.string() }, async ({ name }) => ({
  content: [{ type: "text", text: `Hello, ${name}!` }]
}));
```
