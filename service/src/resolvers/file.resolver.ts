import { GraphQLUpload } from 'apollo-server';
import { writeFileSync } from 'fs';
import { diana } from 'diana-js';

const resolver = {
  Upload: GraphQLUpload,
  Query: {
    uploads: (_: any, args: any) => [],
  },
  Mutation: {
    singleUpload: async (_: any, { file }: { file: any }) => {
      const { createReadStream, filename, mimetype, encoding } = file;
      const stream = createReadStream();
      // console.log(stream);
      const path = `uploads/${diana()}${filename}`;
      writeFileSync(path, stream);

      return { filename, mimetype, encoding };
    }
  }
};

export default resolver;
