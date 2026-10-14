// Only the message viewport moves; never use scrollIntoView (it can move ancestors).
export class MessageScrollController {
  private following = true;
  private opening = true;
  private lastMessageId: string | undefined;
  private height = -1;
  private viewportHeight = -1;
  private forceFollow = false;
  private anchor: { element: HTMLElement; offset: number } | null = null;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly notify: (visible: boolean) => void,
  ) {}

  private nearEnd(tolerance = 96) {
    return (
      this.viewport.scrollHeight -
        this.viewport.clientHeight -
        this.viewport.scrollTop <=
      tolerance
    );
  }

  private capture() {
    const bounds = this.viewport.getBoundingClientRect();
    const element = Array.from(
      this.viewport.querySelectorAll<HTMLElement>("[data-message-id]"),
    ).find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    this.anchor = element
      ? { element, offset: element.getBoundingClientRect().top - bounds.top }
      : null;
  }

  onScroll() {
    if (!this.viewport.clientHeight) return;
    this.following = this.nearEnd();
    this.capture();
    this.notify(!this.nearEnd(4));
  }

  update(lastMessageId: string | undefined, loading: boolean) {
    if (loading) return;
    const newLatest = lastMessageId !== this.lastMessageId;
    this.lastMessageId = lastMessageId;
    if (this.opening && lastMessageId !== undefined) {
      this.opening = false;
      this.following = true;
    }
    this.reconcile(newLatest || this.forceFollow);
    this.forceFollow = false;
  }

  reconcile(force = false) {
    if (!this.viewport.clientHeight) return;
    const resized =
      this.height !== this.viewport.scrollHeight ||
      this.viewportHeight !== this.viewport.clientHeight;
    if (this.following && (resized || force)) {
      this.viewport.scrollTop =
        this.viewport.scrollHeight - this.viewport.clientHeight;
    } else if (
      this.anchor?.element.isConnected &&
      this.viewport.contains(this.anchor.element)
    ) {
      const currentOffset =
        this.anchor.element.getBoundingClientRect().top -
        this.viewport.getBoundingClientRect().top;
      const delta = currentOffset - this.anchor.offset;
      if (Math.abs(delta) > 0.5) this.viewport.scrollTop += delta;
    }
    this.height = this.viewport.scrollHeight;
    this.viewportHeight = this.viewport.clientHeight;
    this.capture();
    this.notify(!this.nearEnd(4));
  }

  followSentMessage() {
    this.following = true;
    this.forceFollow = true;
  }

  preserveOlderMessages() {
    this.following = false;
    this.capture();
  }

  latest() {
    this.following = true;
    this.reconcile(true);
  }
}
