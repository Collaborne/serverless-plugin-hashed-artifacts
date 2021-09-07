# serverless-plugin-hashed-artifacts

Serverless Framework plugin to reduce deployment times by moving artifacts when possible into a hash-addressed path.

_Note: This is experimental, and likely doesn't work for you. In particular [it will break rollbacks](https://github.com/serverless/serverless/pull/9926), and it will refuse to work if not all functions are using pre-defined artifacts and are packaged individually._

## Usage

1. Install the plugin

    ```sh
    npm install --save serverless-plugin-hashed-artifacts
    ```

2. Add the plugin to the `serverless.yml` configuration file

    ```yaml
    plugins:
      - serverless-plugin-hashed-artifacts
    ```

3. Ensure that all functions have a defined `package.artifact` setting, and that `package.individually` is set to `true`.

## License

```text
MIT License

Copyright (c) 2021 Collaborne B.V.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
