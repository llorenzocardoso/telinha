export class ShareAudience {
  private readonly viewers = new Map<string, string>();

  get size(): number {
    return this.viewers.size;
  }

  add(id: string, name: string): "added" | "updated" {
    const known = this.viewers.has(id);
    this.viewers.set(id, name);
    return known ? "updated" : "added";
  }

  remove(id: string): boolean {
    return this.viewers.delete(id);
  }

  has(id: string): boolean {
    return this.viewers.has(id);
  }

  ids(): string[] {
    return [...this.viewers.keys()];
  }

  names(): string[] {
    return [...this.viewers.values()];
  }

  clear(): void {
    this.viewers.clear();
  }
}
