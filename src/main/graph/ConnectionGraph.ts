export interface ConnectionInfo {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  autoApprove: boolean;
}

// The live, in-memory source of truth for "what's connected to what" while
// the app is running — kept in sync by the connections:* IPC calls and
// reloaded whole on workflows:load. This is what the Handoff Engine reads
// to decide where a node's output is allowed to go.
export class ConnectionGraph {
  private readonly connections = new Map<string, ConnectionInfo>();

  replaceAll(connections: ConnectionInfo[]): void {
    this.connections.clear();
    for (const connection of connections) this.connections.set(connection.id, connection);
  }

  upsert(connection: ConnectionInfo): void {
    this.connections.set(connection.id, connection);
  }

  remove(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  removeForNode(nodeId: string): void {
    for (const [id, connection] of this.connections) {
      if (connection.fromNodeId === nodeId || connection.toNodeId === nodeId) {
        this.connections.delete(id);
      }
    }
  }

  setAutoApprove(connectionId: string, autoApprove: boolean): void {
    const connection = this.connections.get(connectionId);
    if (connection) connection.autoApprove = autoApprove;
  }

  getOutgoing(nodeId: string): ConnectionInfo[] {
    return [...this.connections.values()].filter((c) => c.fromNodeId === nodeId);
  }
}
