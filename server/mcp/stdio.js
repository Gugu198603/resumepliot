import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createResumePilotMcpServer } from './sdkServer.js';

const server = createResumePilotMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);
