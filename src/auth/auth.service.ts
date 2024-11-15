import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SignupDto } from './dto/signupdto.dto';
import { User } from './schemas/user.schema';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';
import { RefreshToken } from './schemas/refresh-token.schema';
import { v4 as uuidv4 } from 'uuid';
import { nanoid } from 'nanoid';
import { ResetToken } from './schemas/reset-token.schema';
import { MailService } from 'src/services/mail.service';



@Injectable()
export class AuthService {
    constructor(@InjectModel(User.name) private userModel: Model<User>
        , @InjectModel(RefreshToken.name) private refreshTokenModel: Model<RefreshToken>,
         @InjectModel(ResetToken.name) private resetTokenModel: Model<ResetToken>,
        private jwtService: JwtService,
        private readonly mailService: MailService,
    ) { }


    async signUp(signupData: SignupDto) {
        const { email, name, password } = signupData;
        const emailInUse = await this.userModel.findOne({ email });

        if (emailInUse) {
            throw new BadRequestException('Email already in use');
        }

        const hashedPassword = await bcrypt.hash(password, 10); // Await the hashing process
        await this.userModel.create({
            email,
            name,
            password: hashedPassword,
        });
    }

    async login(credentials: LoginDto) {
        const { email, password } = credentials;
        //Find if user exists by email
        const user = await this.userModel.findOne({ email });
        if (!user) {
            throw new UnauthorizedException('Wrong credentials');
        }

        //Compare entered password with existing password
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            throw new UnauthorizedException('Wrong credentials');
        }

        //Generate JWT tokens
        const tokens = await this.generateUserToken(user._id);
        return {
            ...tokens,
            userId: user._id,
        };
    }

    async refreshTokens(refreshToken: string) {
        const token = await this.refreshTokenModel.findOne({
            token: refreshToken,
            expiryDate: { $gt: new Date() }

        });
        if (!token) {
            //they have to login again in the front 

            throw new UnauthorizedException('Invalid refresh token');
        }
        //if it havent exiperd
        return this.generateUserToken(token.userId);

    }


    //return acces token and refresh token 
    async generateUserToken(userId) {

        const accestoken = this.jwtService.sign({ userId }, { expiresIn: '1h' });

        const refreshToken = uuidv4();
        await this.storeRefreshToken(refreshToken, userId);
        return {
            accestoken
            , refreshToken
        };
    }
    async storeRefreshToken(token: string, userId: string) {
        // Calculate expiry date 7 days from now
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 7);

        await this.refreshTokenModel.updateOne(
            { userId },
            { $set: { expiryDate, token } },
            {
                upsert: true,
            },
        );
    }

    async changePassword(userId, oldPassword: string, newPassword: string): Promise<void> {
        // Ensure userId is a string
      
    
        // Find the user
        const user = await this.userModel.findById(userId);
        if (!user) {
          throw new NotFoundException('User not found');
        }
    
        // Compare the old password with the stored password
        const passwordMatch = await bcrypt.compare(oldPassword, user.password);
        if (!passwordMatch) {
          throw new UnauthorizedException('Wrong credentials');
        }
    
        // Hash the new password and update the user record
        const newHashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = newHashedPassword;
        await user.save();
      }

      async forgotPassword(email: string): Promise<void> {
        const user = await this.userModel.findOne({ email });
        if (!user) {
          throw new NotFoundException('User not found');
        }
    
        // Generate a reset token
        const resetToken = uuidv4();
    
        // Save the reset token to the database
        await this.resetTokenModel.create({
          userId: user._id,
          token: resetToken,
          expiryDate: new Date(Date.now() + 3600000), // 1 hour expiry
        });
    
        // Send the reset token via email
        await this.mailService.sendResetEmail(user.email, resetToken);
      }
    
    
      async verifyReset(resetToken: string, newPassword: string): Promise<void> {
        const tokenEntry = await this.resetTokenModel.findOne({ token: resetToken });
        if (!tokenEntry || tokenEntry.expiryDate < new Date()) {
          throw new UnauthorizedException('Invalid or expired reset token');
        }
    
        // Find the user associated with the reset token
        const user = await this.userModel.findById(tokenEntry.userId);
        if (!user) {
          throw new NotFoundException('User not found');
        }
    
        // Hash the new password and update the user record
        const newHashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = newHashedPassword;
        await user.save();
    
        // Remove the used reset token
        await this.resetTokenModel.deleteOne({ token: resetToken });
      }
}
