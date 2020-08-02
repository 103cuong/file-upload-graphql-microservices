import { Request, Response, NextFunction } from 'express';
import { server, credentials } from 'grpc-graphql-sdk';
import { get } from 'lodash';
import { GraphQLSchema, DocumentNode, ExecutionResult } from 'graphql';
import crypto from 'crypto';
import { ReadStream } from 'fs';

import {
  AppError, ServiceError, ParserError, AuthenticationError,
} from './errors';

type Operation = {
  query: DocumentNode;
  operationName?: string;
  variables?: any;
  context?: {
    graphqlContext?: {
      req?: any;
      res?: any;
    };
  };
}

const streamToString = (stream: ReadStream): Promise<any[]> => {
  const chunks: any[] = []
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => chunks.push(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(chunks))
  })
};

export const relay = (url: string) => (operation: Operation) => new Promise<ExecutionResult>(async (resolve, reject) => {
  const client = new server(url, credentials.createInsecure());
  const graphqlContext = get(operation, 'context.graphqlContext');
  const req = get(graphqlContext, 'req');

  let data: any[] = [];
  console.log(req.body, '---req.body-----')
  if (req.body.variables && req.body.variables.file) {
    const stream = req.body.variables.file.file.createReadStream();
    data = await streamToString(stream);
  }

  client.callRequest({
    headers: JSON.stringify(req.headers),
    query: req.body.query,
    variables: Buffer.concat(data),
  }, (_: any, response: any) => {
    const error = get(response, 'error');
    if (error) {
      const parsedError = JSON.parse(error);
      const extensions = get(parsedError, 'extensions');
      const message = get(parsedError, 'message');
      const locations = get(parsedError, 'locations');
      return reject(new ParserError(message, extensions, locations));
    }
    const data = get(response, 'data');
    if (!data) {
      return reject(new ServiceError(`${url} is not found`));
    }
    resolve({ data: JSON.parse(data) });
  });
});

export const getSchema = (url: string) => new Promise<GraphQLSchema>((resolve, reject) => {
  const client = new server(url, credentials.createInsecure());
  client.callRequest({ query: '{ getSchema }' }, (_: any, response: any) => {
    const error = get(response, 'error');
    if (error) {
      return reject(error);
    }
    const data = get(response, 'data');
    if (!data) {
      return reject(new ServiceError(`${url} is not found`));
    }
    const parsedData = JSON.parse(data).getSchema || '';
    resolve(parsedData.replace('getSchema: String', ''));
  });
});

export const wrapAsync = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const handleError = (
  err: AppError,
  _: Request,
  res: Response,
  next: NextFunction
) => {
  const { message, code, ...rest } = err;
  res.status(200).json({
    errors: [
      {
        code,
        message,
        ...rest,
      },
    ],
  });
  next();
};

export const encryptKey = (publicKey: string, symmetricKey: string) => crypto.publicEncrypt({
  key: publicKey,
  padding: crypto.constants.RSA_PKCS1_PADDING,
}, Buffer.from(symmetricKey, 'utf8')).toString('base64');

export const decryptKey = (publicKey: string, encryptedKey: string) => crypto.publicDecrypt({
  key: publicKey,
  padding: crypto.constants.RSA_PKCS1_PADDING,
}, Buffer.from(encryptedKey, 'base64')).toString('utf8');

export const encryptData = (data: any, symmetricKey: string, iv: string, algorithm: string) => {
  const cipher = crypto.createCipheriv(algorithm, symmetricKey, iv);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
};

export const decryptData = (encryptedData: any, symmetricKey: string, iv: string, algorithm: string) => {
  const decipher = crypto.createDecipheriv(algorithm, symmetricKey, iv);
  let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

export const decryptRequest = (data: any, publicKey: string, algorithm: string) => {
  const { encryptedData, encryptedKey } = data;
  if (!encryptedData || !encryptedKey) {
    throw new AuthenticationError('encrypted data, encrypted key cannot null');
  }
  try {
    const { key, iv } = JSON.parse(decryptKey(publicKey, encryptedKey));
    const decryptedData = decryptData(encryptedData, key, iv, algorithm);
    return decryptedData;
  } catch (error) {
    throw new AuthenticationError(error.message);
  }
};
