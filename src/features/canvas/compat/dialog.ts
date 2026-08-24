type DialogFilter = {
  name?: string;
  extensions?: string[];
};

type OpenOptions = {
  multiple?: boolean;
  directory?: boolean;
  filters?: DialogFilter[];
  title?: string;
};

function acceptFromFilters(filters?: DialogFilter[]) {
  const extensions = filters?.flatMap((filter) => filter.extensions || []) || [];
  if (extensions.length === 0) return "";
  return extensions.map((extension) => `.${extension.replace(/^\./, "")}`).join(",");
}

export async function open(options: OpenOptions = {}) {
  if (options.directory) return null;

  return await new Promise<string | string[] | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = !!options.multiple;
    input.accept = acceptFromFilters(options.filters);
    input.style.display = "none";
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) {
        resolve(null);
        return;
      }
      const urls = await Promise.all(files.map((file) => {
        return new Promise<string>((fileResolve, fileReject) => {
          const reader = new FileReader();
          reader.onload = () => fileResolve(String(reader.result));
          reader.onerror = () => fileReject(reader.error ?? new Error("读取文件失败"));
          reader.readAsDataURL(file);
        });
      }));
      input.remove();
      resolve(options.multiple ? urls : urls[0]);
    };
    document.body.appendChild(input);
    input.click();
  });
}

export async function save(_options?: unknown) {
  return null;
}
