import { Module } from '@nestjs/common';
import { RustfsStorageService } from './rustfs-storage.service';

@Module({ providers: [RustfsStorageService], exports: [RustfsStorageService] })
export class StorageModule {}
