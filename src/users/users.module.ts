import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './users.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }], 'primary'),
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }], 'backup'),
  ],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
