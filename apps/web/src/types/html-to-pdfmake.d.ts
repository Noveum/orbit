declare module 'html-to-pdfmake' {
  interface HtmlToPdfmakeOptions {
    readonly window?: Window;
    readonly defaultStyles?: Record<string, Record<string, unknown>>;
  }
  export default function htmlToPdfmake(html: string, options?: HtmlToPdfmakeOptions): unknown;
}
